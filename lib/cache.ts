// lib/cache.ts
// Persistent Redis cache using @upstash/redis SDK.
// Falls back to in-memory if Upstash env vars not set.
// TTL: 24 hours for scan results, 72 hours stale fallback.

import { CacheEntry } from "./types";

const FRESH_TTL_S = 24 * 60 * 60;       // 24 hours in seconds
const FRESH_TTL_MS = FRESH_TTL_S * 1000;

// ── In-memory L1 cache (always active) ───────────────────────────────────────
const memStore = new Map<string, CacheEntry<unknown>>();

// ── Upstash Redis client (lazy init) ─────────────────────────────────────────
let _redis: any = null;

async function getRedis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = await import("@upstash/redis");
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    return null;
  }
}

// ── Public cache API ──────────────────────────────────────────────────────────
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    // L1: memory first (fastest)
    const mem = memStore.get(key) as CacheEntry<T> | undefined;
    if (mem && Date.now() < mem.expiresAt) return mem.data;

    // L2: Redis
    try {
      const redis = await getRedis();
      if (redis) {
        const raw = await redis.get(key) as string | null;
        if (raw) {
          const entry = (typeof raw === "string" ? JSON.parse(raw) : raw) as CacheEntry<T>;
          if (Date.now() < entry.expiresAt) {
            // Warm L1
            memStore.set(key, entry as CacheEntry<unknown>);
            return entry.data;
          }
        }
      }
    } catch {}

    return null;
  },

  async getStale<T>(key: string): Promise<T | null> {
    const mem = memStore.get(key) as CacheEntry<T> | undefined;
    if (mem) return mem.data;

    try {
      const redis = await getRedis();
      if (redis) {
        const raw = await redis.get(key) as string | null;
        if (raw) {
          const entry = (typeof raw === "string" ? JSON.parse(raw) : raw) as CacheEntry<T>;
          return entry.data;
        }
      }
    } catch {}

    return null;
  },

  async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + FRESH_TTL_MS };

    // Write to L1
    memStore.set(key, entry as CacheEntry<unknown>);

    // Write to Redis with TTL
    try {
      const redis = await getRedis();
      if (redis) {
        await redis.set(key, JSON.stringify(entry), { ex: FRESH_TTL_S });
      }
    } catch {}
  },

  async delete(key: string): Promise<void> {
    memStore.delete(key);
    try {
      const redis = await getRedis();
      if (redis) await redis.del(key);
    } catch {}
  },

  size(): number {
    return memStore.size;
  },
};
