/**
 * How many pieces to fetch at once, adjusted to what the link and the server give.
 * Every couple of seconds the throughput is measured: while adding connections still makes
 * it faster, add more; when it gets clearly slower, take some back. A server that says it
 * is overloaded (429, 503) halves the count at once and holds it there for a while.
 */
export interface PacerOptions {
  start?: number;
  min?: number;
  max?: number;
  /** How long throughput is measured before deciding. */
  windowMs?: number;
  now?: () => number;
}

export class Pacer {
  limit: number;
  private readonly min: number;
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private windowStart: number;
  private windowBytes = 0;
  /** Best throughput seen (bytes/s), and with how many connections. */
  private best = 0;
  /** No raising before this time (after a server complained). */
  private calmUntil = 0;

  constructor(o: PacerOptions = {}) {
    this.min = o.min ?? 2;
    this.max = o.max ?? 16;
    this.limit = Math.max(this.min, Math.min(this.max, o.start ?? 6));
    this.windowMs = o.windowMs ?? 2000;
    this.now = o.now ?? (() => performance.now());
    this.windowStart = this.now();
  }

  /** Bytes just received; returns the (possibly updated) limit. */
  record(bytes: number): number {
    this.windowBytes += bytes;
    const t = this.now();
    const elapsed = t - this.windowStart;
    if (elapsed < this.windowMs) return this.limit;
    const rate = (this.windowBytes * 1000) / elapsed;
    this.windowStart = t;
    this.windowBytes = 0;
    if (rate > this.best * 1.1) {
      // Still getting faster: try a couple more connections.
      this.best = rate;
      if (t >= this.calmUntil) this.limit = Math.min(this.max, this.limit + 2);
    } else if (rate < this.best * 0.6) {
      // Clearly slower than before (congestion, or the link changed): back off a little,
      // and measure again from here.
      this.limit = Math.max(this.min, this.limit - 1);
      this.best = rate;
    }
    return this.limit;
  }

  /** The server asked to slow down. */
  throttled(): number {
    this.limit = Math.max(this.min, Math.floor(this.limit / 2));
    this.calmUntil = this.now() + this.windowMs * 5;
    return this.limit;
  }
}
