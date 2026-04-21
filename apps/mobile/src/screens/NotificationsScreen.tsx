import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Notification, NotificationCategory } from '@vault/types';
import { useAuth } from '../context/AuthContext';
import { createAuthenticatedClient } from '../lib/api';

// Configure how notifications appear when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const CATEGORY_ICONS: Record<NotificationCategory, string> = {
  call: 'CALL',
  meeting: 'MTG',
  message: 'MSG',
  offer: 'OFFER',
  nda: 'NDA',
  deal_stage: 'DEAL',
  listing: 'LST',
  kyc: 'KYC',
};

const CATEGORY_COLORS: Record<NotificationCategory, string> = {
  call: '#34d399',
  meeting: '#60a5fa',
  message: '#a78bfa',
  offer: '#d4a847',
  nda: '#fb923c',
  deal_stage: '#facc15',
  listing: '#f87171',
  kyc: '#78716c',
};

function formatRelativeTime(dateStr: string): string {
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

function NotificationCard({
  item,
  onPress,
}: {
  item: Notification;
  onPress: () => void;
}) {
  const category = item.category as NotificationCategory;
  return (
    <TouchableOpacity
      style={[styles.card, !item.read && styles.cardUnread]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.cardLeft}>
        <View style={[styles.categoryBadge, { borderColor: CATEGORY_COLORS[category] }]}>
          <Text style={[styles.categoryText, { color: CATEGORY_COLORS[category] }]}>
            {CATEGORY_ICONS[category] ?? category.toUpperCase()}
          </Text>
        </View>
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {!item.read && <View style={styles.unreadDot} />}
        </View>
        {item.body != null && item.body.length > 0 && (
          <Text style={styles.cardBody} numberOfLines={2}>
            {item.body}
          </Text>
        )}
        <Text style={styles.cardTime}>{formatRelativeTime(item.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );
}

async function registerForPushNotifications(
  token: string | null,
  userId: string | null,
): Promise<void> {
  if (!userId) return;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('vault-default', {
        name: 'VAULT Notifications',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const pushTokenData = await Notifications.getExpoPushTokenAsync();
    const expoPushToken = pushTokenData.data;

    // Register the push token with the server
    const { createAuthenticatedClient } = await import('../lib/api');
    const client = createAuthenticatedClient(token);
    await client.updateMe({ expoPushToken });
  } catch {
    // Push notifications registration is non-fatal
  }
}

export function NotificationsScreen() {
  const { token, userId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    registerForPushNotifications(token, userId);
  }, [token, userId]);

  const loadNotifications = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const client = createAuthenticatedClient(token);
        const res = await client.getNotifications(50, 0);
        if (res.success && res.data) {
          setNotifications(res.data.items);
          setUnreadCount(res.data.unreadCount);
        }
      } catch {
        // Silently fail — show what we have
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = useCallback(
    async (notificationId: string) => {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      try {
        const client = createAuthenticatedClient(token);
        await client.markNotificationRead(notificationId);
      } catch {
        // Revert optimistic update on failure
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n)),
        );
        setUnreadCount((prev) => prev + 1);
      }
    },
    [token],
  );

  const handleMarkAllRead = useCallback(async () => {
    const prevNotifications = [...notifications];
    const prevCount = unreadCount;
    // Optimistic update
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    try {
      const client = createAuthenticatedClient(token);
      await client.markAllNotificationsRead();
    } catch {
      // Revert
      setNotifications(prevNotifications);
      setUnreadCount(prevCount);
      Alert.alert('Error', 'Failed to mark all notifications as read.');
    }
  }, [notifications, unreadCount, token]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#d4a847" size="large" />
        <Text style={styles.loadingText}>Loading Notifications...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <Text style={styles.unreadSubtitle}>{unreadCount} unread</Text>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAllButton}
            onPress={handleMarkAllRead}
            activeOpacity={0.8}
          >
            <Text style={styles.markAllButtonText}>Mark All Read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationCard
            item={item}
            onPress={() => {
              if (!item.read) handleMarkRead(item.id);
            }}
          />
        )}
        contentContainerStyle={[
          styles.listContent,
          notifications.length === 0 && styles.listContentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadNotifications(true)}
            tintColor="#d4a847"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>All Clear</Text>
            <Text style={styles.emptySubtitle}>
              You have no notifications at this time
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  unreadSubtitle: {
    fontSize: 13,
    color: '#d4a847',
    marginTop: 2,
  },
  markAllButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#292524',
  },
  markAllButtonText: {
    fontSize: 13,
    color: '#a8a29e',
    fontWeight: '600',
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
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#292524',
    gap: 12,
  },
  cardUnread: {
    borderColor: '#3a2a00',
    backgroundColor: '#141108',
  },
  cardLeft: {
    paddingTop: 2,
  },
  categoryBadge: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1917',
  },
  categoryText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  cardContent: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f5f5f4',
    flex: 1,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#d4a847',
  },
  cardBody: {
    fontSize: 13,
    color: '#78716c',
    lineHeight: 18,
    marginBottom: 6,
  },
  cardTime: {
    fontSize: 11,
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
  },
});
