import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ListingWithMedia } from '@vault/types';
import { useAuth } from '../context/AuthContext';
import { createAuthenticatedClient } from '../lib/api';

const CACHE_KEY = 'vault_listings_cache';

type ListingsStackParamList = {
  ListingsList: undefined;
  ListingDetail: { listingId: string };
};

type Props = NativeStackScreenProps<ListingsStackParamList, 'ListingsList'>;

const TIER_COLORS: Record<string, string> = {
  platinum: '#e8d5ff',
  gold: '#d4a847',
  silver: '#a8a29e',
  bronze: '#c97d5a',
};

const TIER_BG: Record<string, string> = {
  platinum: '#3b1f6b',
  gold: '#3a2a00',
  silver: '#292524',
  bronze: '#2a1200',
};

function formatPrice(listing: ListingWithMedia): string {
  if (listing.priceOnRequest) return 'Price on Request';
  if (!listing.priceAmount) return 'Price on Request';
  const amount = parseFloat(listing.priceAmount);
  if (isNaN(amount)) return 'Price on Request';
  const currency = listing.priceCurrency ?? 'AED';
  if (amount >= 1_000_000) {
    return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `${currency} ${amount.toLocaleString()}`;
}

function ListingCard({
  item,
  onPress,
}: {
  item: ListingWithMedia;
  onPress: () => void;
}) {
  const tier = item.qualityTier ?? 'bronze';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardHeader}>
        <View style={[styles.tierBadge, { backgroundColor: TIER_BG[tier] ?? '#1c1917' }]}>
          <Text style={[styles.tierText, { color: TIER_COLORS[tier] ?? '#a8a29e' }]}>
            {tier.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.assetType}>
          {item.assetType.replace(/_/g, ' ').toUpperCase()}
        </Text>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.cardLocation}>
        {item.city}, {item.country}
      </Text>
      <View style={styles.cardFooter}>
        <Text style={styles.cardPrice}>{formatPrice(item)}</Text>
        <View style={styles.statsRow}>
          {item.bedrooms != null && (
            <Text style={styles.statItem}>{item.bedrooms} bed</Text>
          )}
          {item.bathrooms != null && (
            <Text style={styles.statItem}>{item.bathrooms} bath</Text>
          )}
          {item.sizeSqm != null && (
            <Text style={styles.statItem}>{parseFloat(item.sizeSqm).toLocaleString()} sqm</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function ListingsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [listings, setListings] = useState<ListingWithMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadListings = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const client = createAuthenticatedClient(token);
        const res = await client.getListings({ limit: 50 });
        if (res.success && res.data) {
          const items = res.data.items;
          setListings(items);
          try {
            await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(items));
          } catch {
            // Cache write failure is non-fatal
          }
        } else {
          throw new Error(res.error?.message ?? 'Failed to load listings');
        }
      } catch {
        // Try offline cache
        try {
          const cached = await AsyncStorage.getItem(CACHE_KEY);
          if (cached) {
            setListings(JSON.parse(cached) as ListingWithMedia[]);
            setError('Showing cached data. Pull to refresh when online.');
          } else {
            setError('Unable to load listings. Please check your connection.');
          }
        } catch {
          setError('Unable to load listings. Please check your connection.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  const filtered = searchQuery.trim()
    ? listings.filter(
        (l) =>
          l.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          l.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
          l.country.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : listings;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#d4a847" size="large" />
        <Text style={styles.loadingText}>Loading Properties...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by title, city, country..."
          placeholderTextColor="#57534e"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {error != null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ListingCard
            item={item}
            onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadListings(true)}
            tintColor="#d4a847"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No listings found</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery ? 'Try adjusting your search' : 'Pull down to refresh'}
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
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1c1917',
  },
  searchInput: {
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#292524',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#f5f5f4',
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
  card: {
    backgroundColor: '#111111',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#292524',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tierBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tierText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  assetType: {
    fontSize: 10,
    color: '#78716c',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#f5f5f4',
    lineHeight: 24,
    marginBottom: 4,
  },
  cardLocation: {
    fontSize: 13,
    color: '#78716c',
    marginBottom: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#d4a847',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statItem: {
    fontSize: 12,
    color: '#a8a29e',
    backgroundColor: '#1c1917',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
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
  },
});
