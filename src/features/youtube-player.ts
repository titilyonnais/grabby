/**
 * Experimental YouTube support (offscreen document).
 *
 * YouTube doesn't let its player be embedded inside youtube.com itself, so the hidden copy
 * that records a video lives here, in the extension's invisible document: the user's tab
 * is never touched, and the download goes on even if they leave the page. The page hook
 * runs inside this player like in any YouTube frame and records it.
 */
const frames = new Map<string, HTMLIFrameElement>();

export function startHiddenPlayer(jobId: string, src: string): void {
  stopHiddenPlayer(jobId);
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return;
  }
  if (url.origin !== 'https://www.youtube.com' || !url.pathname.startsWith('/embed/')) return;
  const f = document.createElement('iframe');
  f.src = url.href;
  f.allow = 'autoplay; encrypted-media';
  f.width = '640';
  f.height = '360';
  document.body.appendChild(f);
  frames.set(jobId, f);
}

export function stopHiddenPlayer(jobId: string): void {
  frames.get(jobId)?.remove();
  frames.delete(jobId);
}
