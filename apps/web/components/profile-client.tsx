'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import { Button, Input, Label } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

export function ProfileClient() {
  const { token, user, setAuth, privateKeyStatus } = useAuth();
  const [status, setStatus] = useState<string | null>(null);

  if (!user || !token) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Sign in to view profile settings</h1>
        </div>
      </main>
    );
  }

  async function updateProfile(formData: FormData) {
    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
    });

    const response = await client.updateMe({
      displayName: String(formData.get('displayName') ?? ''),
      preferredCurrency: String(formData.get('preferredCurrency') ?? ''),
      preferredLanguage: String(formData.get('preferredLanguage') ?? ''),
      expoPushToken: String(formData.get('expoPushToken') ?? ''),
    });

    setStatus(response.success ? 'Profile updated' : response.error?.message ?? 'Update failed');
    await setAuth(token);
  }

  async function generateKeys() {
    const privateKeyPassword = window.prompt('Choose a password for your private key (min 8 characters)');
    if (!privateKeyPassword) {
      setStatus('Key generation cancelled');
      return;
    }

    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
    });

    const response = await client.generateKeys(privateKeyPassword);
    setStatus(response.success ? 'Encryption keys generated' : response.error?.message ?? 'Key generation failed');
    if (response.success) {
      await setAuth(token, { privateKeyPassword });
    } else {
      await setAuth(token);
    }
  }

  async function submitKyc() {
    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
    });

    const response = await client.submitKyc([{ type: 'passport', base64: 'mock-base64' }]);
    setStatus(response.success ? 'Mock KYC submitted' : response.error?.message ?? 'KYC submission failed');
    await setAuth(token);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        void submitKyc();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <main className="page-wrap section-space space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Profile</p>
        <h1 className="mt-3 text-5xl text-stone-50">Private identity settings</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_360px]">
        <form action={(formData) => void updateProfile(formData)} className="cinematic-panel rounded-[2rem] p-7">
          <h2 className="text-2xl text-stone-50">Personal information</h2>
          <p className="mt-2 text-sm text-stone-400">Sensitive fields are prepared for encrypted storage.</p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <Field label="Display name" name="displayName" defaultValue={user.displayName ?? ''} />
            <Field label="Currency" name="preferredCurrency" defaultValue={user.preferredCurrency} />
            <Field label="Language" name="preferredLanguage" defaultValue={user.preferredLanguage} />
            <Field label="Push token" name="expoPushToken" defaultValue={user.expoPushToken ?? ''} />
          </div>
          <div className="mt-8 flex justify-end">
            <Button type="submit" variant="gold">Save profile</Button>
          </div>
        </form>

        <aside className="space-y-6">
          <div className="cinematic-panel rounded-[2rem] p-7">
            <h2 className="text-2xl text-stone-50">Identity verification</h2>
            <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-amber-300"
                style={{ width: user.kycStatus === 'approved' ? '100%' : user.kycStatus === 'submitted' ? '66%' : '33%' }}
              />
            </div>
            <p className="mt-3 text-sm text-stone-300">Current status: {user.kycStatus}</p>
            <p className="mt-2 text-xs uppercase tracking-[0.24em] text-stone-500">
              Shortcut: Ctrl/Cmd + Shift + K
            </p>
            <Button className="mt-5 w-full" variant="outline" onClick={submitKyc}>
              Upload KYC documents
            </Button>
            <Button asChild className="mt-3 w-full" variant="gold">
              <Link href="/kyc">Open full KYC wizard</Link>
            </Button>
          </div>

          <div className="cinematic-panel rounded-[2rem] p-7">
            <h2 className="text-2xl text-stone-50">End-to-end encryption</h2>
            <p className="mt-3 text-sm text-stone-300">Generate a libsodium keypair for future encrypted deal-room messaging.</p>
            <p className="mt-2 text-xs uppercase tracking-[0.22em] text-stone-500">
              Key status: {privateKeyStatus}
            </p>
            <Button className="mt-5 w-full" variant="gold" onClick={generateKeys}>
              Generate keys
            </Button>
          </div>
        </aside>
      </div>

      {status ? <p className="text-sm text-amber-100">{status}</p> : null}
    </main>
  );
}

function Field({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={defaultValue} />
    </div>
  );
}
