import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/providers/auth-provider';
import { LanguageProvider } from '@/components/providers/language-provider';
import { SiteHeader } from '@/components/site-header';
import { AIConcierge } from '@/components/ai-concierge';

export const metadata: Metadata = {
  title: 'VAULT',
  description: "The world's most private platform for trophy real estate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <LanguageProvider>
            <div className="app-shell">
              <SiteHeader />
              {children}
              <AIConcierge />
            </div>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
