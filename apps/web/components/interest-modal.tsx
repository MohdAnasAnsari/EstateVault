'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import { Button } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

interface InterestModalProps {
  listingId: string;
  sellerId: string;
  agentId: string | null;
}

export function InterestModal({ listingId, sellerId, agentId }: InterestModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, token } = useAuth();
  const isSellerSideViewer = Boolean(user && (user.id === sellerId || user.id === agentId));
  const ownerMessage =
    'This listing is already managed by your account. Buyer deal rooms open only after another qualified user expresses interest.';

  async function createDealRoom() {
    if (isSellerSideViewer) {
      setError(ownerMessage);
      return;
    }

    if (!token) {
      router.push('/auth/signin');
      return;
    }

    setLoading(true);
    setError(null);

    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
    });

    const response = await client.createDealRoomFromListing(listingId);
    if (!response.success || !response.data) {
      setError(response.error?.message ?? 'Unable to open the encrypted deal room.');
      setLoading(false);
      return;
    }

    setOpen(false);
    router.push(`/deal-rooms/${response.data.id}`);
    router.refresh();
  }

  return (
    <>
      <Button variant="gold" size="lg" onClick={() => setOpen(true)}>
        {isSellerSideViewer ? 'Manage Access' : 'Express Interest'}
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="cinematic-panel w-full max-w-lg rounded-[1.8rem] p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Identity check</p>
            <h3 className="mt-3 text-2xl text-stone-50">Protected deal-room access</h3>
            <p className="mt-3 text-sm leading-7 text-stone-300">
              {isSellerSideViewer && user
                ? ownerMessage
                : user
                ? `Signed in as ${user.displayName ?? user.email}. Your current access tier is ${user.accessTier.replace('_', ' ')} and KYC status is ${user.kycStatus}.`
                : 'Sign in or request access to pass identity checks before confidential deal-room details are released.'}
            </p>
            <div className="mt-6 grid gap-3 text-sm text-stone-400">
              <div className="pill justify-between">
                <span>Identity tier</span>
                <span>{user?.accessTier ?? 'Not authenticated'}</span>
              </div>
              <div className="pill justify-between">
                <span>KYC</span>
                <span>{user?.kycStatus ?? 'Pending sign-in'}</span>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
              {isSellerSideViewer ? (
                <Button
                  variant="gold"
                  onClick={() => {
                    setOpen(false);
                    router.push('/dashboard');
                  }}
                >
                  Open dashboard
                </Button>
              ) : (
                <Button variant="gold" onClick={() => void createDealRoom()} disabled={loading}>
                  {loading ? 'Opening...' : 'Enter encrypted room'}
                </Button>
              )}
            </div>
            {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
