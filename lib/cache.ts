// lib/cache.ts
// Persistent Redis cache via Upstash REST API.
// Falls back to in-memory if Upstash env vars not set.
// TTL: 24 hours for scan results, 72 hours stale fallback.

import { CacheEntry } from "./types";

const FRESH_TTL_S = 24 * 60 * 60;      // 24 hours in seconds (Redis EX)
const FRESH_TTL_MS = FRESH_TTL_S * 1000;
const STALE_TTL_MS = 72 * 60 * 60 * 1000;

// ── In-memory fallback ────────────────────────────────────────────────────────
const memStore = new Map<string, CacheEntry<unknown>>();

// ── Upstash REST helpers ──────────────────────────────────────────────────────
function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisGet(key: string): Promise<string | null> {
  const cfg = getRedisConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    });
    const data = await res.json();
    return data.result ?? null;
  } catch {
    return null;
  }
}

async function redisSet(key: string, value: string, exSeconds: number): Promise<void> {
  const cfg = getRedisConfig();
  if (!cfg) return;
  try {
    await fetch(`${cfg.url}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([value, "EX", exSeconds]),
    });
  } catch {}
}

// ── Public cache API ──────────────────────────────────────────────────────────
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    // Try Redis first
    const raw = await redisGet(key);
    if (raw) {
      try {
        const entry = JSON.parse(raw) as CacheEntry<T>;
        if (Date.now() < entry.expiresAt) return entry.data;
      } catch {}
    }

    // Fallback to memory
    const entry = memStore.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      memStore.delete(key);
      return null;
    }
    return entry.data;
  },

  async getStale<T>(key: string): Promise<T | null> {
    const raw = await redisGet(key);
    if (raw) {
      try {
        return (JSON.parse(raw) as CacheEntry<T>).data;
      } catch {}
    }
    const entry = memStore.get(key) as CacheEntry<T> | undefined;
    return entry ? entry.data : null;
  },

  async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + FRESH_TTL_MS };
    const raw = JSON.stringify(entry);

    // Write to Redis
    await redisSet(key, raw, FRESH_TTL_S);

    // Also write to memory as local L1 cache
    memStore.set(key, entry as CacheEntry<unknown>);
  },

  size(): number {
    return memStore.size;
  },
};
