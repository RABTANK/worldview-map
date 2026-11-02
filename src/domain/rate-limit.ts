export class RateLimiter {
  private buckets = new Map<string, { start: number; count: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  hit(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    if (this.buckets.size > 10_000) {
      for (const [id, bucket] of this.buckets) {
        if (now - bucket.start >= this.windowMs) this.buckets.delete(id);
      }
    }
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.windowMs) {
      bucket = { start: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > this.limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((this.windowMs - (now - bucket.start)) / 1000)) };
    }
    return { ok: true, retryAfterSec: 0 };
  }
}
