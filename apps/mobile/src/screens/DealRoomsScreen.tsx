import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DealRoomSummary, DealRoomStatus } from '@vault/types';
import { useAuth } from '../context/AuthContext';
import { createAuthenticatedClient } from '../lib/api';

type DealRoomsStackParamList = {
  DealRoomsList: undefined;
  DealRoomDetail: { dealRoomId: string; dealRoomTitle?: string };
};

type Props = NativeStackScreenProps<DealRoomsStackParamList, 'DealRoomsList'>;

const STATUS_LABELS: Record<DealRoomStatus, string> = {
  interest_expressed: 'Interest Expressed',
  pending_nda: 'Pending NDA',
  nda_signed: 'NDA Signed',
  due_diligence: 'Due Diligence',
  offer_submitted: 'Offer Submitted',
  offer_accepted: 'Offer Accepted',
  closed: 'Closed',
};

const STATUS_COLORS: Record<DealRoomStatus, string> = {
  interest_expressed: '#60a5fa',
  pending_nda: '#fb923c',
  nda_signed: '#a78bfa',
  due_diligence: '#facc15',
  offer_submitted: '#34d399',
  offer_accepted: '#4ade80',
  closed: '#78716c',
};

const STATUS_BG: Record<DealRoomStatus, string> = {
  interest_expressed: '#1e3a5f',
  pending_nda: '#3a1800',
  nda_signed: '#2e1a5e',
  due_diligence: '#3a2a00',
  offer_submitted: '#0f2a2a',
  offer_accepted: '#0f2a1a',
  closed: '#1c1917',
};

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'No messages yet';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function DealRoomCard({
  item,
  onPress,
}: {
  item: DealRoomSummary;
  onPress: () => void;
}) {
  const status = item.status as DealRoomStatus;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_BG[status] }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[status] }]}>
            {STATUS_LABELS[status]}
          </Text>
        </View>
        {item.unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unreadCount}</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.listingTitle}
      </Text>
      <Text style={styles.cardLocation}>
        {item.city}, {item.country}
      </Text>
      <View style={styles.cardFooter}>
        <Text style={styles.pseudonym}>as {item.participantPseudonym}</Text>
        <Text style={styles.lastMessage}>{formatRelativeTime(item.lastMessageAt)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function DealRoomsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [dealRooms, setDealRooms] = useState<DealRoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDealRooms = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const client = createAuthenticatedClient(token);
        const res = await client.getDealRooms();
        if (res.success && res.data) {
          setDealRooms(res.data);
        } else {
          setError(res.error?.message ?? 'Failed to load deal rooms.');
        }
      } catch {
        setError('Unable to load deal rooms. Please check your connection.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadDealRooms();
  }, [loadDealRooms]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#d4a847" size="large" />
        <Text style={styles.loadingText}>Loading Deal Rooms...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error != null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={dealRooms}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <DealRoomCard
            item={item}
            onPress={() =>
              navigation.navigate('DealRoomDetail', {
                dealRoomId: item.id,
                dealRoomTitle: item.listingTitle,
              })
            }
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          dealRooms.length === 0 && styles.listContentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadDealRooms(true)}
            tintColor="#d4a847"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Deal Rooms</Text>
            <Text style={styles.emptySubtitle}>
              Express interest in a property to open a private deal room
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
  card: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#292524',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  unreadBadge: {
    backgroundColor: '#d4a847',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  unreadText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0a0a0a',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f5f5f4',
    lineHeight: 22,
    marginBottom: 4,
  },
  cardLocation: {
    fontSize: 13,
    color: '#78716c',
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pseudonym: {
    fontSize: 12,
    color: '#a8a29e',
    fontStyle: 'italic',
  },
  lastMessage: {
    fontSize: 12,
    color: '#57534e',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
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
    lineHeight: 20,
  },
});
