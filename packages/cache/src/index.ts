import IORedis from 'ioredis';

let _client: IORedis | null = null;

export function getRedis(): IORedis {
  if (_client) return _client;

  const url = process.env['REDIS_URL'];
  if (!url) throw new Error('REDIS_URL environment variable is not set');

  _client = new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  _client.on('error', (err: Error) => {
    console.error('[Redis] Connection error:', err.message);
  });

  return _client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  const value = await client.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const client = getRedis();
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await client.set(key, serialized, 'EX', ttlSeconds);
  } else {
    await client.set(key, serialized);
  }
}

export async function cacheDel(key: string): Promise<void> {
  const client = getRedis();
  await client.del(key);
}

export async function cacheGetOrSet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds?: number,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const fresh = await fetcher();
  await cacheSet(key, fresh, ttlSeconds);
  return fresh;
}

// Cache key helpers
export const CacheKeys = {
  listing: (id: string) => `listing:${id}`,
  listingSlug: (slug: string) => `listing:slug:${slug}`,
  listingsList: (page: number, limit: number, filters: string) =>
    `listings:${page}:${limit}:${filters}`,
  user: (id: string) => `user:${id}`,
  userSaved: (userId: string) => `user:${userId}:saved`,
  exchangeRate: (from: string, to: string) => `fx:${from}:${to}`,
  listingQuality: (id: string) => `quality:${id}`,
} as const;

export { IORedis };
