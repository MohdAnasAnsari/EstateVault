import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ListingWithMedia } from '@vault/types';
import { useAuth } from '../context/AuthContext';
import { createAuthenticatedClient } from '../lib/api';

type ListingsStackParamList = {
  ListingsList: undefined;
  ListingDetail: { listingId: string };
};

type Props = NativeStackScreenProps<ListingsStackParamList, 'ListingDetail'>;

const TIER_COLORS: Record<string, string> = {
  platinum: '#e8d5ff',
  gold: '#d4a847',
  silver: '#a8a29e',
  bronze: '#c97d5a',
};

function formatPrice(listing: ListingWithMedia): string {
  if (listing.priceOnRequest) return 'Price on Request';
  if (!listing.priceAmount) return 'Price on Request';
  const amount = parseFloat(listing.priceAmount);
  if (isNaN(amount)) return 'Price on Request';
  const currency = listing.priceCurrency ?? 'AED';
  if (amount >= 1_000_000) {
    return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  }
  return `${currency} ${amount.toLocaleString()}`;
}

function InfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{String(value)}</Text>
    </View>
  );
}

export function ListingDetailScreen({ route, navigation }: Props) {
  const { listingId } = route.params;
  const { token } = useAuth();
  const [listing, setListing] = useState<ListingWithMedia | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingInterest, setSavingInterest] = useState(false);
  const [savingPortfolio, setSavingPortfolio] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const client = createAuthenticatedClient(token);
        const res = await client.getListing(listingId);
        if (res.success && res.data) {
          setListing(res.data);
          navigation.setOptions({ title: res.data.title });
        } else {
          Alert.alert('Error', res.error?.message ?? 'Failed to load property.');
        }
      } catch {
        Alert.alert('Error', 'Unable to connect. Please check your connection.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [listingId, token, navigation]);

  const handleExpressInterest = useCallback(async () => {
    if (!listing) return;
    setSavingInterest(true);
    try {
      const client = createAuthenticatedClient(token);
      const res = await client.createDealRoomFromListing(listing.id);
      if (res.success && res.data) {
        Alert.alert(
          'Interest Expressed',
          'A private deal room has been created for this property. You can access it in the Deals tab.',
          [{ text: 'OK' }],
        );
      } else {
        const message = res.error?.message ?? 'Could not create deal room.';
        Alert.alert('Notice', message);
      }
    } catch {
      Alert.alert('Error', 'Could not express interest at this time. Please try again.');
    } finally {
      setSavingInterest(false);
    }
  }, [listing, token]);

  const handleSave = useCallback(async () => {
    if (!listing) return;
    setSavingPortfolio(true);
    try {
      const client = createAuthenticatedClient(token);
      const res = await client.toggleSaveListing(listing.id);
      if (res.success && res.data) {
        const saved = res.data.saved;
        Alert.alert(
          saved ? 'Saved' : 'Removed',
          saved ? 'Property added to your saved listings.' : 'Property removed from saved listings.',
        );
      } else {
        Alert.alert('Notice', res.error?.message ?? 'Unable to update saved status.');
      }
    } catch {
      Alert.alert('Error', 'Could not save property at this time. Please try again.');
    } finally {
      setSavingPortfolio(false);
    }
  }, [listing, token]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#d4a847" size="large" />
        <Text style={styles.loadingText}>Loading Property...</Text>
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Property not found.</Text>
      </View>
    );
  }

  const tier = listing.qualityTier ?? 'bronze';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Hero Header */}
      <View style={styles.hero}>
        <View style={styles.heroBadgeRow}>
          <View style={styles.tierBadge}>
            <Text style={[styles.tierBadgeText, { color: TIER_COLORS[tier] ?? '#a8a29e' }]}>
              {tier.toUpperCase()}
            </Text>
          </View>
          {listing.titleDeedVerified && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedBadgeText}>VERIFIED</Text>
            </View>
          )}
        </View>
        <Text style={styles.heroTitle}>{listing.title}</Text>
        <Text style={styles.heroLocation}>
          {listing.district ? `${listing.district}, ` : ''}
          {listing.city}, {listing.country}
        </Text>
        <Text style={styles.heroPrice}>{formatPrice(listing)}</Text>
      </View>

      {/* Key Specs */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Property Details</Text>
        <View style={styles.specsGrid}>
          {listing.bedrooms != null && (
            <View style={styles.specItem}>
              <Text style={styles.specValue}>{listing.bedrooms}</Text>
              <Text style={styles.specLabel}>Bedrooms</Text>
            </View>
          )}
          {listing.bathrooms != null && (
            <View style={styles.specItem}>
              <Text style={styles.specValue}>{listing.bathrooms}</Text>
              <Text style={styles.specLabel}>Bathrooms</Text>
            </View>
          )}
          {listing.sizeSqm != null && (
            <View style={styles.specItem}>
              <Text style={styles.specValue}>
                {parseFloat(listing.sizeSqm).toLocaleString()}
              </Text>
              <Text style={styles.specLabel}>sqm</Text>
            </View>
          )}
          {listing.floors != null && (
            <View style={styles.specItem}>
              <Text style={styles.specValue}>{listing.floors}</Text>
              <Text style={styles.specLabel}>Floors</Text>
            </View>
          )}
          {listing.yearBuilt != null && (
            <View style={styles.specItem}>
              <Text style={styles.specValue}>{listing.yearBuilt}</Text>
              <Text style={styles.specLabel}>Year Built</Text>
            </View>
          )}
        </View>
      </View>

      {/* Info Table */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Information</Text>
        <View style={styles.infoTable}>
          <InfoRow label="Asset Type" value={listing.assetType.replace(/_/g, ' ')} />
          <InfoRow label="Status" value={listing.status.replace(/_/g, ' ')} />
          <InfoRow label="Visibility" value={listing.visibility.replace(/_/g, ' ')} />
          <InfoRow label="Days on Market" value={listing.daysOnMarket} />
          <InfoRow label="Quality Score" value={`${listing.listingQualityScore}/100`} />
          {listing.sellerMotivation && (
            <InfoRow
              label="Seller Motivation"
              value={listing.sellerMotivation.replace(/_/g, ' ')}
            />
          )}
          {listing.titleDeedNumber && (
            <InfoRow label="Title Deed No." value={listing.titleDeedNumber} />
          )}
        </View>
      </View>

      {/* Description */}
      {listing.description != null && listing.description.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.descriptionText}>{listing.description}</Text>
        </View>
      )}

      {/* Key Features */}
      {listing.keyFeatures.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Features</Text>
          <View style={styles.featuresList}>
            {listing.keyFeatures.map((feature, index) => (
              <View key={index} style={styles.featureItem}>
                <View style={styles.featureDot} />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsSection}>
        <TouchableOpacity
          style={[styles.primaryAction, savingInterest && styles.actionDisabled]}
          onPress={handleExpressInterest}
          disabled={savingInterest}
          activeOpacity={0.85}
        >
          {savingInterest ? (
            <ActivityIndicator color="#0a0a0a" size="small" />
          ) : (
            <Text style={styles.primaryActionText}>Express Interest</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryAction, savingPortfolio && styles.actionDisabled]}
          onPress={handleSave}
          disabled={savingPortfolio}
          activeOpacity={0.85}
        >
          {savingPortfolio ? (
            <ActivityIndicator color="#d4a847" size="small" />
          ) : (
            <Text style={styles.secondaryActionText}>Save to Portfolio</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    paddingBottom: 40,
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
  errorText: {
    color: '#f5f5f4',
    fontSize: 16,
  },
  hero: {
    backgroundColor: '#111111',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#292524',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tierBadge: {
    backgroundColor: '#1c1917',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#292524',
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  verifiedBadge: {
    backgroundColor: '#0f2a1a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4ade80',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f5f5f4',
    lineHeight: 30,
    marginBottom: 6,
  },
  heroLocation: {
    fontSize: 14,
    color: '#78716c',
    marginBottom: 14,
  },
  heroPrice: {
    fontSize: 24,
    fontWeight: '800',
    color: '#d4a847',
  },
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1917',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#a8a29e',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  specsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  specItem: {
    backgroundColor: '#111111',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    minWidth: 80,
    borderWidth: 1,
    borderColor: '#292524',
  },
  specValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f5f5f4',
  },
  specLabel: {
    fontSize: 11,
    color: '#78716c',
    marginTop: 2,
  },
  infoTable: {
    backgroundColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#292524',
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1917',
  },
  infoLabel: {
    fontSize: 13,
    color: '#78716c',
    flex: 1,
  },
  infoValue: {
    fontSize: 13,
    color: '#f5f5f4',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  descriptionText: {
    fontSize: 15,
    color: '#a8a29e',
    lineHeight: 24,
  },
  featuresList: {
    gap: 10,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  featureDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#d4a847',
    marginTop: 6,
  },
  featureText: {
    fontSize: 14,
    color: '#a8a29e',
    flex: 1,
    lineHeight: 20,
  },
  actionsSection: {
    padding: 20,
    gap: 12,
  },
  primaryAction: {
    backgroundColor: '#d4a847',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryActionText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: '#d4a847',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  secondaryActionText: {
    color: '#d4a847',
    fontSize: 15,
    fontWeight: '600',
  },
  actionDisabled: {
    opacity: 0.6,
  },
});
