import path from 'node:path';
import type { NextConfig } from 'next';

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
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
};

export default nextConfig;
