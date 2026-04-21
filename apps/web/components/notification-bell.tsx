'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, Settings } from 'lucide-react';
import { VaultApiClient } from '@vault/api-client';
import type { Notification } from '@vault/types';

const API_BASE_URL =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1')
    : 'http://localhost:4000/api/v1';

const CATEGORY_ICONS: Record<string, string> = {
  call: '📞',
  meeting: '📅',
  message: '💬',
  offer: '🤝',
  nda: '📝',
  deal_stage: '🔄',
  listing: '🏛',
  kyc: '🛡',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface NotificationBellProps {
  token: string | null;
  onNewNotification?: () => void;
}

export function NotificationBell({ token, onNewNotification }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const api = new VaultApiClient({ baseUrl: API_BASE_URL, getToken: () => token });

  async function fetchNotifications() {
    if (!token) return;
    setLoading(true);
    const res = await api.getNotifications(20);
    if (res.success && res.data) {
      setItems(res.data.items);
      setUnreadCount(res.data.unreadCount);
    }
    setLoading(false);
  }

  async function markAllRead() {
    if (!token) return;
    await api.markAllNotificationsRead();
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }

  async function markOneRead(id: string) {
    if (!token) return;
    await api.markNotificationRead(id);
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  useEffect(() => {
    if (open) void fetchNotifications();
  }, [open, token]);

  useEffect(() => {
    if (!token) return;
    void api.getNotifications(1).then((res) => {
      if (res.success && res.data) setUnreadCount(res.data.unreadCount);
    });
  }, [token]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (!token) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-stone-300 hover:text-stone-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-stone-950">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-[1.6rem] border border-white/10 bg-stone-950/95 shadow-2xl backdrop-blur-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
            <h3 className="text-sm font-medium text-stone-100">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-xs text-stone-400 hover:text-amber-300 transition-colors"
                >
                  <Check className="h-3 w-3" />
                  Mark all read
                </button>
              )}
              <Link
                href="/settings/notifications"
                onClick={() => setOpen(false)}
                className="text-stone-400 hover:text-stone-200"
              >
                <Settings className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="px-5 py-8 text-center text-sm text-stone-500">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-stone-500">No notifications yet</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (!n.read) void markOneRead(n.id);
                  }}
                  className={`w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-white/3 transition-colors border-b border-white/5 last:border-0 ${
                    !n.read ? 'bg-amber-400/4' : ''
                  }`}
                >
                  <span className="mt-0.5 text-base">
                    {CATEGORY_ICONS[n.category] ?? '🔔'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm leading-snug ${
                          !n.read ? 'text-stone-100' : 'text-stone-400'
                        }`}
                      >
                        {n.title}
                      </p>
                      {!n.read && (
                        <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-1 text-xs text-stone-500 line-clamp-2">{n.body}</p>
                    )}
                    <p className="mt-1 text-[10px] text-stone-600 uppercase tracking-[0.18em]">
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-white/8 px-5 py-3">
            <Link
              href="/settings/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-stone-500 hover:text-stone-300 uppercase tracking-[0.18em]"
            >
              Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
