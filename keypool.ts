// lib/keypool.ts
// Rotating API key pool with daily UTC reset recovery.
// Pass comma-separated keys in env vars (e.g. MORALIS_API_KEY=key1,key2,key3)

interface KeyEntry {
  key: string;
  exhaustedAt: number | null; // timestamp when benched, null if active
}

export class KeyPool {
  private keys: KeyEntry[];
  private cursor: number = 0;

  constructor(commaSeparated: string) {
    const raw = commaSeparated
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (raw.length === 0) throw new Error("KeyPool: no keys provided");

    this.keys = raw.map((key) => ({ key, exhausted: false, exhaustedAt: null }));
  }

  /** Get the next available key, skipping benched ones. Returns null if all exhausted. */
  next(): string | null {
    const now = Date.now();
    const utcMidnight = this.nextUtcMidnight();

    // Recover keys exhausted before today's UTC midnight
    for (const entry of this.keys) {
      if (entry.exhaustedAt !== null && entry.exhaustedAt < utcMidnight) {
        entry.exhaustedAt = null;
      }
    }

    // Round-robin through active keys
    const start = this.cursor;
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (start + i) % this.keys.length;
      if (this.keys[idx].exhaustedAt === null) {
        this.cursor = (idx + 1) % this.keys.length;
        return this.keys[idx].key;
      }
    }

    return null; // all keys exhausted
  }

  /** Mark the current key as exhausted (benched until UTC midnight reset) */
  bench(key: string): void {
    const entry = this.keys.find((e) => e.key === key);
    if (entry) entry.exhaustedAt = Date.now();
  }

  get activeCount(): number {
    const utcMidnight = this.nextUtcMidnight();
    return this.keys.filter(
      (e) => e.exhaustedAt === null || e.exhaustedAt < utcMidnight
    ).length;
  }

  get totalCount(): number {
    return this.keys.length;
  }

  private nextUtcMidnight(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }
}
