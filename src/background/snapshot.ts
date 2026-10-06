import { hostOf } from '../parsers/url';
import { buildFilename, folderFor } from '../shared/filename';
import { uid } from '../shared/ids';
import { getSettings } from '../shared/settings';
import { cleanTitle } from '../shared/title';
import type { MediaItem } from '../shared/types';
import { addHistory } from './history';
import { folderNames } from './jobs';

/** Where in the video a photo was taken, for its name: "4m05s", "1h02m05s". */
export function momentName(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '';
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}h${String(m).padStart(2, '0')}m${s}s` : `${m}m${s}s`;
}

/** The video's place on a screenshot, in its pixels, kept inside the picture. */
export function cropBox(rect: { x: number; y: number; w: number; h: number }, dpr: number, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const k = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const x = Math.max(0, Math.round(rect.x * k));
  const y = Math.max(0, Math.round(rect.y * k));
  const w = Math.min(width - x, Math.round((rect.x + rect.w) * k) - x);
  const h = Math.min(height - y, Math.round((rect.y + rect.h) * k) - y);
  return w >= 8 && h >= 8 ? { x, y, w, h } : null;
}

async function dataUrlOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

/** A small copy for the library's tile. */
async function smallCopy(bitmap: ImageBitmap): Promise<string | undefined> {
  try {
    const w = Math.min(320, bitmap.width);
    const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    return await dataUrlOf(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
  } catch {
    return undefined;
  }
}

/**
 * « Photo »: the picture the video shows, saved as a PNG next to the other files. The page
 * gives it when the site lets it read the video; otherwise the tab is photographed and the
 * video's place cut out of it.
 */
export async function saveSnapshot(tab: chrome.tabs.Tab, msg: { dataUrl?: string; rect?: { x: number; y: number; w: number; h: number }; dpr?: number; time?: number }, item?: MediaItem): Promise<boolean> {
  let bitmap: ImageBitmap;
  try {
    if (msg.dataUrl && /^data:image\/png;base64,/.test(msg.dataUrl)) {
      bitmap = await createImageBitmap(await (await fetch(msg.dataUrl)).blob());
    } else if (msg.rect && tab.windowId !== undefined) {
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const whole = await createImageBitmap(await (await fetch(shot)).blob());
      const box = cropBox(msg.rect, msg.dpr ?? 1, whole.width, whole.height);
      if (!box) return false;
      bitmap = await createImageBitmap(whole, box.x, box.y, box.w, box.h);
    } else return false;
  } catch (e) {
    console.warn('[grabby] photo', e);
    return false;
  }
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  c.getContext('2d')!.drawImage(bitmap, 0, 0);
  const png = await c.convertToBlob({ type: 'image/png' });
  const s = await getSettings();
  const pageUrl = item?.pageUrl ?? tab.url ?? '';
  const site = hostOf(pageUrl).replace(/^www\./, '');
  const title = item?.title || cleanTitle(tab.title ?? '', hostOf(pageUrl)) || 'Grabby';
  const word = chrome.i18n.getMessage('photoName') || 'photo';
  const moment = momentName(msg.time);
  const filename = buildFilename(
    s.template,
    { title: `${title} (${word}${moment ? ` ${moment}` : ''})`, site, date: new Date(), format: 'PNG', ...(item?.author ? { channel: item.author } : {}) },
    'png',
    folderFor(s.folder, { site, kind: 'image' }, folderNames()),
  );
  try {
    const downloadId = await chrome.downloads.download({ url: await dataUrlOf(png), filename, conflictAction: 'uniquify', saveAs: s.saveAs });
    const thumbnail = await smallCopy(bitmap);
    await addHistory({
      id: uid(),
      filename: filename.split('/').pop() ?? filename,
      title: `${title}${moment ? ` (${moment})` : ''}`,
      pageUrl,
      size: png.size,
      date: Date.now(),
      downloadId,
      quality: `${bitmap.width}×${bitmap.height}`,
      ...(thumbnail ? { thumbnail } : {}),
    });
    return true;
  } catch (e) {
    console.warn('[grabby] photo', e);
    return false;
  }
}
