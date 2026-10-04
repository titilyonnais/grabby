export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const rounded = i === 0 || v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${rounded} ${UNITS[i]}`;
}

/**
 * "1080p" from a resolution, the way people name it: a film letterboxed to 1920×800 is
 * 1080p (it's 16:9 width that counts), and so is a vertical 1080×1920 video.
 */
export function qualityLabel(height?: number, bandwidth?: number, width?: number): string {
  let lines = height;
  if (height && width) {
    const [long, short] = width >= height ? [width, height] : [height, width];
    lines = Math.max(short, Math.round((long * 9) / 16));
  }
  if (lines) return `${lines}p`;
  if (bandwidth) {
    return bandwidth >= 1_000_000
      ? `${Math.round(bandwidth / 100_000) / 10} Mb/s`
      : `${Math.round(bandwidth / 1000)} kb/s`;
  }
  return '';
}
