import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@vault/ui', '@vault/api-client', '@vault/types'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
};

export default nextConfig;
