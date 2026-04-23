import { Redis } from 'ioredis';

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  exists(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  ping(message?: string): Promise<string>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

let client: Redis | null = null;

export function getRedis(): RedisClient {
  if (client) return client as unknown as RedisClient;

  const url = process.env['REDIS_URL'];
  if (!url) throw new Error('REDIS_URL environment variable is not set');

  client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('error', (error: Error) => {
    console.error('[Redis] Connection error:', error.message);
  });

  return client as unknown as RedisClient;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const value = await getRedis().get(key);
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const redis = getRedis();
  const serialized = JSON.stringify(value);

  if (ttlSeconds) {
    await redis.set(key, serialized, 'EX', ttlSeconds);
    return;
  }

  await redis.set(key, serialized);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(key);
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

export { Redis as IORedis } from 'ioredis';
