interface PayloadEntry { json: string; expiresAt: number; bytes: number }
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;
const MAX_ENTRIES = 512;

/** Serialized immutable payloads only. Authorization always stays in Postgres. */
export class VersionedPayloadCache {
  private readonly entries = new Map<string, PayloadEntry>();
  private bytes = 0;

  get<T>(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) { this.remove(key); return null; }
    this.entries.delete(key); this.entries.set(key, entry);
    // Return a separate object: callers cannot mutate another request's payload.
    return JSON.parse(entry.json) as T;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    try {
      const json = JSON.stringify(value);
      if (!json || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
      const bytes = Buffer.byteLength(key) + Buffer.byteLength(json);
      if (bytes > MAX_ENTRY_BYTES) return;
      this.remove(key);
      while (this.bytes + bytes > MAX_BYTES || this.entries.size >= MAX_ENTRIES) this.remove(this.entries.keys().next().value!);
      this.entries.set(key, { json, bytes, expiresAt: Date.now() + Math.min(300, ttlSeconds) * 1000 });
      this.bytes += bytes;
    } catch { /* Rebuildable cache bookkeeping must never fail a request. */ }
  }

  clear(): void { this.entries.clear(); this.bytes = 0; }
  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
}
