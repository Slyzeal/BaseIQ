// lib/cache.ts
// Persistent cache using Upstash Redis REST pipeline API.
// TTL: 24 hours. Falls back to in-memory if Redis unavailable.

import { CacheEntry } from "./types";

const FRESH_TTL_S = 24 * 60 * 60;
const FRESH_TTL_MS = FRESH_TTL_S * 1000;

const memStore = new Map<string, CacheEntry<unknown>>();

function cfg() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisGet(key: string): Promise<string | null> {
  const c = cfg();
  if (!c) return null;
  try {
    const res = await fetch(`${c.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${c.token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.result === "string" ? data.result : null;
  } catch { return null; }
}

async function redisSet(key: string, value: string, ex: number): Promise<void> {
  const c = cfg();
  if (!c) return;
  try {
    // Upstash pipeline format — the correct way to SET with large values
    const res = await fetch(`${c.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([["SET", key, value, "EX", ex]]),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[cache] Redis pipeline failed:", res.status);
    }
  } catch (e) {
    console.error("[cache] Redis set error:", e);
  }
}

async function redisDel(key: string): Promise<void> {
  const c = cfg();
  if (!c) return;
  try {
    await fetch(`${c.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["DEL", key]]),
    });
  } catch {}
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    // L1: memory (instant)
    const mem = memStore.get(key) as CacheEntry<T> | undefined;
    if (mem && Date.now() < mem.expiresAt) return mem.data;

    // L2: Redis
    const raw = await redisGet(key);
    if (raw) {
      try {
        const entry = JSON.parse(raw) as CacheEntry<T>;
        if (Date.now() < entry.expiresAt) {
          memStore.set(key, entry as CacheEntry<unknown>);
          return entry.data;
        }
      } catch {}
    }
    return null;
  },

  async getStale<T>(key: string): Promise<T | null> {
    const mem = memStore.get(key) as CacheEntry<T> | undefined;
    if (mem) return mem.data;
    const raw = await redisGet(key);
    if (raw) {
      try { return (JSON.parse(raw) as CacheEntry<T>).data; } catch {}
    }
    return null;
  },

  async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + FRESH_TTL_MS };
    memStore.set(key, entry as CacheEntry<unknown>);
    await redisSet(key, JSON.stringify(entry), FRESH_TTL_S);
  },

  async delete(key: string): Promise<void> {
    memStore.delete(key);
    await redisDel(key);
  },

  size(): number { return memStore.size; },
};
