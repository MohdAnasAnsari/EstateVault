import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/providers/auth-provider';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: 'VAULT',
  description: "The world's most private platform for trophy real estate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <div className="app-shell">
            <SiteHeader />
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
