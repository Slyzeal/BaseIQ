// lib/cache.ts
// In-memory LRU-style cache. Swappable for Upstash Redis with no API changes.
// TTL: 5 minutes for fresh scans, 24 hours for stale fallback.

import { CacheEntry } from "./types";

const FRESH_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const store = new Map<string, CacheEntry<unknown>>();

export const cache = {
  get<T>(key: string): T | null {
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.data;
  },

  getStale<T>(key: string): T | null {
    // Returns expired entries too — used as last-resort fallback
    const entry = store.get(key) as CacheEntry<T> | undefined;
    return entry ? entry.data : null;
  },

  set<T>(key: string, data: T, stale = false): void {
    store.set(key, {
      data,
      expiresAt: Date.now() + (stale ? STALE_TTL_MS : FRESH_TTL_MS),
    });
  },

  has(key: string): boolean {
    return store.has(key);
  },

  delete(key: string): void {
    store.delete(key);
  },

  size(): number {
    return store.size;
  },
};
