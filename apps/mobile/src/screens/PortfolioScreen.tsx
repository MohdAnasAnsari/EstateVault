import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import type { PortfolioEntry, PortfolioStage } from '@vault/types';
import { useAuth } from '../context/AuthContext';
import { createAuthenticatedClient } from '../lib/api';

const STAGE_ORDER: PortfolioStage[] = [
  'saved',
  'interested',
  'nda',
  'due_diligence',
  'offer',
  'won',
];

const STAGE_LABELS: Record<PortfolioStage, string> = {
  saved: 'Saved',
  interested: 'Interested',
  nda: 'NDA Stage',
  due_diligence: 'Due Diligence',
  offer: 'Offer Submitted',
  won: 'Won',
};

const STAGE_COLORS: Record<PortfolioStage, string> = {
  saved: '#78716c',
  interested: '#60a5fa',
  nda: '#a78bfa',
  due_diligence: '#fb923c',
  offer: '#facc15',
  won: '#4ade80',
};

const STAGE_BG: Record<PortfolioStage, string> = {
  saved: '#292524',
  interested: '#1e3a5f',
  nda: '#2e1a5e',
  due_diligence: '#3a1800',
  offer: '#3a2a00',
  won: '#0f2a1a',
};

interface SectionData {
  stage: PortfolioStage;
  entries: PortfolioEntry[];
}

function getListingTitle(entry: PortfolioEntry): string {
  if (entry.listingSnapshot && typeof entry.listingSnapshot === 'object') {
    const snap = entry.listingSnapshot as Record<string, unknown>;
    if (typeof snap['title'] === 'string') return snap['title'];
  }
  return `Property ${entry.listingId?.substring(0, 8) ?? entry.id.substring(0, 8)}`;
}

function PortfolioEntryCard({ entry }: { entry: PortfolioEntry }) {
  const stage = entry.stage as PortfolioStage;
  const title = getListingTitle(entry);

  return (
    <View style={styles.entryCard}>
      <View style={styles.entryHeader}>
        <View style={[styles.stagePill, { backgroundColor: STAGE_BG[stage] }]}>
          <Text style={[styles.stagePillText, { color: STAGE_COLORS[stage] }]}>
            {STAGE_LABELS[stage]}
          </Text>
        </View>
        {entry.aiInsight != null && (
          <View style={styles.aiIndicator}>
            <Text style={styles.aiIndicatorText}>AI</Text>
          </View>
        )}
      </View>
      <Text style={styles.entryTitle} numberOfLines={2}>
        {title}
      </Text>
      {entry.customLabel != null && (
        <Text style={styles.customLabel}>{entry.customLabel}</Text>
      )}
      {entry.aiInsight != null && (
        <Text style={styles.aiInsight} numberOfLines={2}>
          {entry.aiInsight}
        </Text>
      )}
      <Text style={styles.entryDate}>
        Added {new Date(entry.createdAt).toLocaleDateString()}
      </Text>
    </View>
  );
}

function SectionHeader({ stage, count }: { stage: PortfolioStage; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionDot, { backgroundColor: STAGE_COLORS[stage] }]} />
      <Text style={styles.sectionLabel}>{STAGE_LABELS[stage]}</Text>
      <View style={styles.sectionCount}>
        <Text style={styles.sectionCountText}>{count}</Text>
      </View>
    </View>
  );
}

export function PortfolioScreen() {
  const { token } = useAuth();
  const [sections, setSections] = useState<SectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPortfolio = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const client = createAuthenticatedClient(token);
        const res = await client.getSavedListings();
        if (res.success && res.data) {
          // getSavedListings returns SavedListingWithListing[] - map to PortfolioEntry-like structure
          // Since portfolio entries have a stage concept, we treat saved listings as 'saved' stage
          const items: PortfolioEntry[] = res.data.map((saved) => ({
            id: saved.id,
            userId: saved.userId,
            listingId: saved.listingId,
            listingSnapshot: saved.listing as unknown as Record<string, unknown>,
            stage: 'saved' as PortfolioStage,
            customLabel: null,
            aiInsight: null,
            lastAiInsightAt: null,
            createdAt: saved.createdAt,
            updatedAt: saved.createdAt,
          }));
          buildSections(items);
        } else {
          setError(res.error?.message ?? 'Failed to load portfolio.');
        }
      } catch {
        setError('Unable to load portfolio. Please check your connection.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  function buildSections(entries: PortfolioEntry[]) {
    const grouped = new Map<PortfolioStage, PortfolioEntry[]>();
    for (const stage of STAGE_ORDER) grouped.set(stage, []);
    for (const entry of entries) {
      const stage = entry.stage as PortfolioStage;
      const existing = grouped.get(stage) ?? [];
      existing.push(entry);
      grouped.set(stage, existing);
    }
    const result: SectionData[] = [];
    for (const stage of STAGE_ORDER) {
      const stageEntries = grouped.get(stage) ?? [];
      if (stageEntries.length > 0) {
        result.push({ stage, entries: stageEntries });
      }
    }
    setSections(result);
  }

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#d4a847" size="large" />
        <Text style={styles.loadingText}>Loading Portfolio...</Text>
      </View>
    );
  }

  type ListItem =
    | { type: 'header'; stage: PortfolioStage; count: number }
    | { type: 'entry'; entry: PortfolioEntry };

  const flatData: ListItem[] = [];
  for (const section of sections) {
    flatData.push({ type: 'header', stage: section.stage, count: section.entries.length });
    for (const entry of section.entries) {
      flatData.push({ type: 'entry', entry });
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>My Portfolio</Text>
        <Text style={styles.screenSubtitle}>
          {sections.reduce((sum, s) => sum + s.entries.length, 0)} properties tracked
        </Text>
      </View>

      {error != null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={flatData}
        keyExtractor={(item, index) =>
          item.type === 'header' ? `hdr-${item.stage}` : `entry-${item.entry.id}-${index}`
        }
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return <SectionHeader stage={item.stage} count={item.count} />;
          }
          return <PortfolioEntryCard entry={item.entry} />;
        }}
        contentContainerStyle={[
          styles.listContent,
          flatData.length === 0 && styles.listContentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadPortfolio(true)}
            tintColor="#d4a847"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Properties Yet</Text>
            <Text style={styles.emptySubtitle}>
              Browse listings and save properties to track them here
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#78716c',
    fontSize: 14,
    marginTop: 12,
  },
  screenHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1917',
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f5f5f4',
  },
  screenSubtitle: {
    fontSize: 13,
    color: '#78716c',
    marginTop: 2,
  },
  errorBanner: {
    backgroundColor: '#2a1a00',
    borderBottomWidth: 1,
    borderBottomColor: '#d4a847',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: '#d4a847',
    fontSize: 13,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  listContentEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#a8a29e',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  sectionCount: {
    backgroundColor: '#1c1917',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#78716c',
  },
  entryCard: {
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#292524',
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  stagePill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stagePillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  aiIndicator: {
    backgroundColor: '#1a2a3a',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  aiIndicatorText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#60a5fa',
    letterSpacing: 1,
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f5f5f4',
    lineHeight: 22,
    marginBottom: 4,
  },
  customLabel: {
    fontSize: 13,
    color: '#d4a847',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  aiInsight: {
    fontSize: 12,
    color: '#78716c',
    lineHeight: 18,
    marginBottom: 8,
    fontStyle: 'italic',
  },
  entryDate: {
    fontSize: 11,
    color: '#57534e',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f5f5f4',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#78716c',
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
});
