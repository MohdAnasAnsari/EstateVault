import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;

  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL environment variable is not set');

  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  _db = drizzle(client, { schema, logger: process.env['NODE_ENV'] === 'development' });
  return _db;
}

export type Db = ReturnType<typeof getDb>;
