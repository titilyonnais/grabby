const YT_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'youtubekids.com', 'googlevideo.com', 'ytimg.com'];

/** True for any YouTube-owned host (site, short links, embeds, video CDN, images). */
export function isYouTubeUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return YT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
