/**
 * "Quand télécharger": downloads wait for a time of day (a window that may run past
 * midnight), for Wi-Fi, and go no faster than a chosen speed.
 */

/** Minutes since midnight. */
export type Minutes = number;

export const DAY: Minutes = 24 * 60;

/** Minutes since midnight of a date, in local time. */
export const minutesOf = (d: Date): Minutes => d.getHours() * 60 + d.getMinutes();

/** "22:00" for 1320. */
export function hhmm(m: Minutes): string {
  const v = ((Math.round(m) % DAY) + DAY) % DAY;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 1320 for "22:00" (also "22h", "22h30", "7:5"); null when it isn't a time. */
export function parseHhmm(s: string): Minutes | null {
  const m = /^\s*(\d{1,2})\s*(?:[:hH.]\s*(\d{1,2})?)?\s*$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Inside the window [from, to)? A window running past midnight (22:00–07:00) works too; from = to is all day. */
export function inWindow(now: Minutes, from: Minutes, to: Minutes): boolean {
  if (from === to) return true;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** When the window opens next (a timestamp), or `now` itself when it is open. */
export function nextOpening(now: Date, from: Minutes, to: Minutes): number {
  const m = minutesOf(now);
  if (inWindow(m, from, to)) return now.getTime();
  const at = new Date(now);
  at.setSeconds(0, 0);
  at.setHours(Math.floor(from / 60), from % 60);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** What a download waits for before it starts. */
export type Hold = { why: 'schedule'; until: number } | { why: 'wifi' };

export interface Gate {
  scheduleOn: boolean;
  scheduleFrom: Minutes;
  scheduleTo: Minutes;
  wifiOnly: boolean;
}

/**
 * Whether new downloads may start now. `connection` is the browser's connection type: only
 * some systems tell it (ChromeOS, Android); unknown, Wi-Fi only never holds anything.
 */
export function holdOf(g: Gate, now: Date, connection: string | undefined): Hold | null {
  if (g.scheduleOn && !inWindow(minutesOf(now), g.scheduleFrom, g.scheduleTo)) {
    return { why: 'schedule', until: nextOpening(now, g.scheduleFrom, g.scheduleTo) };
  }
  if (g.wifiOnly && connection && !WIRED_OR_WIFI.has(connection)) return { why: 'wifi' };
  return null;
}

/** Connection types that count as "not mobile data". */
const WIRED_OR_WIFI = new Set(['wifi', 'ethernet', 'wimax']);

/** Speeds offered (bytes per second); 0 is no limit. */
export const RATE_LIMITS = [0, 256 * 1024, 512 * 1024, 1024 ** 2, 2 * 1024 ** 2, 5 * 1024 ** 2, 10 * 1024 ** 2] as const;

/**
 * Lets data through at no more than `rate` bytes per second, for everything sharing it.
 * A small burst is allowed so short pieces don't wait at all.
 */
export class RateLimiter {
  private rate = 0;
  private tokens = 0;
  private last = 0;
  /** Time source, replaceable in tests. */
  constructor(private now: () => number = () => Date.now()) {}

  set(rate: number): void {
    if (rate === this.rate) return;
    this.rate = Math.max(0, rate);
    this.tokens = Math.min(this.tokens, this.burst());
    this.last = this.now();
  }

  get limit(): number {
    return this.rate;
  }

  private burst(): number {
    return this.rate / 4;
  }

  /** How long to wait (ms) before `n` more bytes may pass; the bytes are counted as taken. */
  delayFor(n: number): number {
    if (!this.rate) return 0;
    const now = this.now();
    this.tokens = Math.min(this.burst(), this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    this.tokens -= n;
    return this.tokens >= 0 ? 0 : (-this.tokens / this.rate) * 1000;
  }

  /** Waits as long as needed for `n` bytes (none without a limit). */
  async take(n: number, signal?: AbortSignal): Promise<void> {
    const ms = this.delayFor(n);
    if (ms <= 0) return;
    await new Promise<void>((ok, ko) => {
      const t = setTimeout(ok, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          ko(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

/**
 * A hidden player records at several times the normal speed: with a limit, no faster than
 * the limit allows for the video's bitrate (never under normal speed).
 */
export function playbackCap(limit: number, bitsPerSecond: number | undefined): number | undefined {
  if (!limit || !bitsPerSecond) return undefined;
  const ratio = (limit * 8) / bitsPerSecond;
  return [16, 8, 4, 2, 1].find((r) => r <= ratio) ?? 1;
}
