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

export function qualityLabel(height?: number, bandwidth?: number): string {
  if (height) return `${height}p`;
  if (bandwidth) {
    return bandwidth >= 1_000_000
      ? `${Math.round(bandwidth / 100_000) / 10} Mb/s`
      : `${Math.round(bandwidth / 1000)} kb/s`;
  }
  return '';
}
