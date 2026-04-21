'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, Mail, Smartphone, Globe } from 'lucide-react';
import { VaultApiClient } from '@vault/api-client';
import type { NotificationCategory, NotificationPreference } from '@vault/types';
import { Button } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  call: 'Calls',
  meeting: 'Meetings',
  message: 'Messages',
  offer: 'Offers',
  nda: 'NDAs',
  deal_stage: 'Deal stage changes',
  listing: 'Listing updates',
  kyc: 'KYC & compliance',
};

const CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  call: 'Incoming calls and call summaries',
  meeting: 'Meeting requests, confirmations, and reminders',
  message: 'New encrypted messages in deal rooms',
  offer: 'New offers and counter-offers',
  nda: 'NDA signatures and status changes',
  deal_stage: 'Deal room stage progressions',
  listing: 'Your listing status, quality score, and reviews',
  kyc: 'KYC review outcomes and compliance alerts',
};

type Channel = 'inApp' | 'email' | 'push';

const CHANNELS: Array<{ key: Channel; label: string; icon: React.ReactNode }> = [
  { key: 'inApp', label: 'In-app', icon: <Bell className="h-4 w-4" /> },
  { key: 'email', label: 'Email', icon: <Mail className="h-4 w-4" /> },
  { key: 'push', label: 'Push', icon: <Smartphone className="h-4 w-4" /> },
];

export function NotificationSettingsClient() {
  const { token } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);

  const api = useMemo(
    () => new VaultApiClient({ baseUrl: API_BASE_URL, getToken: () => token }),
    [token],
  );

  useEffect(() => {
    if (!token) return;
    void api.getNotificationPreferences().then((res) => {
      if (res.success && res.data) setPreferences(res.data);
      setLoading(false);
    });
    setPushSupported('serviceWorker' in navigator && 'PushManager' in window);
  }, [token, api]);

  function getPref(category: NotificationCategory): NotificationPreference | undefined {
    return preferences.find((p) => p.category === category);
  }

  function toggleChannel(category: NotificationCategory, channel: Channel, value: boolean) {
    setPreferences((prev) =>
      prev.map((p) =>
        p.category === category
          ? { ...p, [channel]: value }
          : p,
      ),
    );
  }

  async function savePreferences() {
    if (!token) return;
    setSaving(true);
    await api.updateNotificationPreferences({
      preferences: preferences.map((p) => ({
        category: p.category,
        inApp: p.inApp,
        email: p.email,
        push: p.push,
      })),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        setPushSubscribed(true);
        return;
      }
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? 'placeholder-vapid-key',
      });
      const json = sub.toJSON();
      if (json.endpoint && json.keys?.['p256dh'] && json.keys?.['auth']) {
        await api.subscribeWebPush({
          endpoint: json.endpoint,
          p256dh: json.keys['p256dh']!,
          auth: json.keys['auth']!,
        });
      }
      setPushSubscribed(true);
    } catch {
      // User denied or not supported
    }
  }

  const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as NotificationCategory[];

  return (
    <main className="page-wrap section-space">
      <div className="max-w-3xl">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl text-stone-50">Notification settings</h1>
            <p className="mt-3 text-sm text-stone-400">
              Choose how you receive alerts for each event type. All notifications reference pseudonyms only.
            </p>
          </div>
          <Button
            variant="gold"
            disabled={saving}
            onClick={() => void savePreferences()}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </Button>
        </div>

        {pushSupported && !pushSubscribed && (
          <div className="mb-6 rounded-[1.6rem] border border-amber-300/15 bg-amber-400/8 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-amber-200">
                  <Globe className="h-4 w-4" />
                  <p className="text-sm font-medium">Enable browser push notifications</p>
                </div>
                <p className="mt-1.5 text-sm text-stone-400">
                  Get instant alerts even when VAULT is not open.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void subscribePush()}>
                Enable
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="rounded-[1.6rem] border border-white/8 bg-white/3 px-6 py-8 text-center text-sm text-stone-500">
            Loading preferences…
          </div>
        ) : (
          <div className="rounded-[1.6rem] border border-white/8 bg-white/3 overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_repeat(3,80px)] gap-4 border-b border-white/8 px-6 py-4 text-xs uppercase tracking-[0.2em] text-stone-500">
              <span>Event</span>
              {CHANNELS.map((ch) => (
                <span key={ch.key} className="flex items-center justify-center gap-1.5">
                  {ch.icon}
                  {ch.label}
                </span>
              ))}
            </div>

            {ALL_CATEGORIES.map((category, i) => {
              const pref = getPref(category);
              const isLast = i === ALL_CATEGORIES.length - 1;
              return (
                <div
                  key={category}
                  className={`grid grid-cols-[1fr_repeat(3,80px)] gap-4 items-center px-6 py-4 ${
                    !isLast ? 'border-b border-white/5' : ''
                  }`}
                >
                  <div>
                    <p className="text-sm text-stone-100">{CATEGORY_LABELS[category]}</p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {CATEGORY_DESCRIPTIONS[category]}
                    </p>
                  </div>
                  {CHANNELS.map((ch) => {
                    const value = pref ? pref[ch.key] : ch.key === 'inApp';
                    return (
                      <div key={ch.key} className="flex justify-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={value}
                          onClick={() => toggleChannel(category, ch.key, !value)}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                            value ? 'bg-amber-400' : 'bg-stone-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              value ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
