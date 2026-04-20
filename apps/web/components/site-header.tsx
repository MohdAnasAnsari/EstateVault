'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

export function SiteHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/35 backdrop-blur-xl">
      <div className="page-wrap flex items-center justify-between gap-4 py-4">
        <Link href="/" className="flex items-center gap-3 text-sm uppercase tracking-[0.35em] text-stone-100">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-300/35 bg-amber-400/10">
            <ShieldCheck className="h-5 w-5 text-amber-200" />
          </span>
          VAULT
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-stone-300 md:flex">
          <Link href="/listings">Listings</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/kyc">KYC</Link>
          {user?.role === 'admin' ? <Link href="/admin">Admin</Link> : null}
          <Link href="/profile">Profile</Link>
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden text-sm text-stone-300 sm:block">
                {user.displayName ?? user.email}
              </span>
              <Button variant="outline" onClick={logout}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="ghost">
                <Link href="/auth/signin">Sign in</Link>
              </Button>
              <Button asChild variant="gold">
                <Link href="/auth/signup">Request access</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
