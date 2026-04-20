'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input, Label } from '@vault/ui';
import { VaultApiClient } from '@vault/api-client';
import { useAuth } from './providers/auth-provider';

interface AuthFormProps {
  mode: 'signin' | 'signup';
}

const api = new VaultApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
});

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { setAuth } = useAuth();
  const [role, setRole] = useState<'buyer' | 'seller' | 'agent'>('buyer');
  const [error, setError] = useState<string | null>(null);
  const [reraStatus, setReraStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(formData: FormData) {
    setLoading(true);
    setError(null);

    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    const displayName = String(formData.get('displayName') ?? '');
    const nationality = String(formData.get('nationality') ?? '');
    const reraOrn = String(formData.get('reraOrn') ?? '');

    const response =
      mode === 'signup'
        ? await api.register({
            email,
            password,
            displayName,
            role,
            ...(nationality ? { nationality } : {}),
            ...(role === 'agent' && reraOrn ? { reraOrn } : {}),
          })
        : await api.login({ email, password });

    if (!response.success || !response.data?.token) {
      setError(response.error?.message ?? 'Authentication failed');
      setLoading(false);
      return;
    }

    await setAuth(response.data.token, { privateKeyPassword: password });
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <form
      action={(formData) => void onSubmit(formData)}
      className="cinematic-panel w-full max-w-xl rounded-[2rem] p-8"
    >
      <p className="text-xs uppercase tracking-[0.3em] text-stone-500">
        {mode === 'signup' ? 'Request access' : 'Sign in'}
      </p>
      <h1 className="mt-3 text-4xl text-stone-50">
        {mode === 'signup' ? 'Secure your place inside VAULT' : 'Return to your private workspace'}
      </h1>

      <div className="mt-8 grid gap-5">
        {mode === 'signup' ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input id="displayName" name="displayName" required placeholder="Discreet alias" />
            </div>
            <div className="grid gap-3">
              <Label>Role</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(['buyer', 'seller', 'agent'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRole(option)}
                    className={`rounded-2xl border px-4 py-3 text-sm capitalize ${role === option ? 'border-amber-300/50 bg-amber-400/10 text-amber-100' : 'border-white/10 bg-white/5 text-stone-300'}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nationality">Nationality</Label>
              <Input id="nationality" name="nationality" placeholder="UAE" />
            </div>
            {role === 'agent' ? (
              <div className="grid gap-2">
                <Label htmlFor="reraOrn">RERA ORN</Label>
                <div className="flex gap-3">
                  <Input id="reraOrn" name="reraOrn" required minLength={10} maxLength={10} />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const input = document.getElementById('reraOrn') as HTMLInputElement | null;
                      if (!input?.value) return;
                      const response = await api.validateRera(input.value);
                      setReraStatus(
                        response.success && response.data?.valid
                          ? `Valid until ${response.data.expiryDate?.slice(0, 10)}`
                          : response.error?.message ?? 'RERA validation failed',
                      );
                    }}
                  >
                    Validate
                  </Button>
                </div>
                {reraStatus ? <p className="text-sm text-emerald-200">{reraStatus}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="you@vault.com" />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}

      <div className="mt-8 flex justify-end">
        <Button type="submit" variant="gold" size="lg" disabled={loading}>
          {loading ? 'Please wait...' : mode === 'signup' ? 'Request access' : 'Sign in'}
        </Button>
      </div>
    </form>
  );
}
