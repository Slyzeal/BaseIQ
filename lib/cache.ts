// lib/cache.ts
// Persistent cache using Upstash Redis REST API directly.
// No SDK — raw HTTP calls to avoid import issues in serverless.
// TTL: 24 hours. Falls back to in-memory if Redis unavailable.

import { CacheEntry } from "./types";

const FRESH_TTL_S = 24 * 60 * 60;
const FRESH_TTL_MS = FRESH_TTL_S * 1000;

const memStore = new Map<string, CacheEntry<unknown>>();

// Upstash REST API — correct format
// GET: https://{url}/get/{key}  → { result: value }
// SET: https://{url}/set/{key}/{value}/ex/{seconds} → { result: "OK" }
async function upstashGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.result === "string" ? data.result : null;
  } catch {
    return null;
  }
}

async function upstashSet(key: string, value: string, exSeconds: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    // Upstash REST SET with EX: POST to /set/{key} with body
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value, ex: exSeconds }),
      cache: "no-store",
    });
    const data = await res.json();
    if (data.result !== "OK") {
      console.warn("[cache] Redis set failed:", data);
    }
  } catch (e) {
    console.error("[cache] Redis set error:", e);
  }
}

async function upstashDel(key: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/del/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {}
}

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    // L1: memory
    const mem = memStore.get(key) as CacheEntry<T> | undefined;
    if (mem && Date.now() < mem.expiresAt) return mem.data;

    // L2: Redis
    const raw = await upstashGet(key);
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
    const raw = await upstashGet(key);
    if (raw) {
      try { return (JSON.parse(raw) as CacheEntry<T>).data; } catch {}
    }
    return null;
  },

  async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + FRESH_TTL_MS };
    memStore.set(key, entry as CacheEntry<unknown>);
    await upstashSet(key, JSON.stringify(entry), FRESH_TTL_S);
  },

  async delete(key: string): Promise<void> {
    memStore.delete(key);
    await upstashDel(key);
  },

  size(): number { return memStore.size; },
};
