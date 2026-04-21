import path from 'node:path';
import type { NextConfig } from 'next';

const CDN_HOSTNAME = process.env['CDN_URL']
  ? new URL(process.env['CDN_URL']).hostname
  : undefined;

const R2_HOSTNAME = process.env['R2_PUBLIC_URL']
  ? new URL(process.env['R2_PUBLIC_URL']).hostname
  : undefined;

const nextConfig: NextConfig = {
  transpilePackages: ['@vault/ui', '@vault/api-client', '@vault/types', '@vault/crypto'],

  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'libsodium-wrappers': path.resolve(
        process.cwd(),
        '../../node_modules/.pnpm/libsodium-wrappers@0.7.16/node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js',
      ),
    };
    return config;
  },

  // Phase 7: Restrict image domains to known CDN + R2 origins
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    remotePatterns: [
      // Cloudflare CDN
      ...(CDN_HOSTNAME
        ? [{ protocol: 'https' as const, hostname: CDN_HOSTNAME }]
        : []),
      // Cloudflare R2 public bucket
      ...(R2_HOSTNAME
        ? [{ protocol: 'https' as const, hostname: R2_HOSTNAME }]
        : []),
      // Dev: allow localhost
      { protocol: 'http' as const, hostname: 'localhost' },
      // Fallback for any https in dev/staging (restrict further in prod)
      ...(process.env['NODE_ENV'] !== 'production'
        ? [{ protocol: 'https' as const, hostname: '**' }]
        : []),
    ],
  },

  // Phase 7: Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
