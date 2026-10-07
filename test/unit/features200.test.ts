import { describe, expect, it } from 'vitest';
import { checkFile, mp4Boxes, sizeMatches } from '../../src/shared/verify';
import { fromSynced, staleKeys, SYNC_PREFIX, toSynced } from '../../src/shared/sync';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';
import { omniboxRequest } from '../../src/shared/batch';
import { savedBefore, youTubeIdOf } from '../../src/shared/saved';
import { browserName, reportOf, systemName } from '../../src/shared/report';
import { audioFilters, CLEAN_SOUND, cleanEdit, encodeAttempts } from '../../src/shared/finish';
import type { HistoryEntry, Job } from '../../src/shared/types';

/* ------------------------------------------------------------ helpers */
const enc = new TextEncoder();
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[] = []) => [...u32(8 + body.length), ...enc.encode(type), ...body];
/** A small MP4: ftyp, moov with an mvhd of 10 s, mdat. */
const mp4 = (seconds = 10) => {
  const mvhd = box('mvhd', [0, 0, 0, 0, ...u32(0), ...u32(0), ...u32(1000), ...u32(seconds * 1000), ...new Array(80).fill(0)]);
  return new Uint8Array([...box('ftyp', [...enc.encode('isom'), 0, 0, 2, 0]), ...box('moov', mvhd), ...box('mdat', new Array(64).fill(7))]);
};
const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  filename: 'video.mp4',
  title: 'Une vidéo',
  pageUrl: 'https://example.com/v',
  size: 1000,
  date: Date.UTC(2026, 9, 6, 12),
  downloadId: 1,
  ...over,
});

/* ------------------------------------------------------- « Fichiers vérifiés » */
describe('checkFile', () => {
  it('reads a whole MP4 and its duration', () => {
    const r = checkFile(mp4(10), 'mp4');
    expect(r.ok).toBe(true);
    expect(r.duration).toBe(10);
    expect(mp4Boxes(mp4()).boxes.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat']);
  });
  it('finds an MP4 cut short or without its index', () => {
    const whole = mp4();
    expect(checkFile(whole.subarray(0, whole.length - 10), 'mp4')).toMatchObject({ ok: false, reason: 'mdat cut short' });
    const noMoov = new Uint8Array([...box('ftyp', [...enc.encode('isom'), 0, 0, 2, 0]), ...box('mdat', [1, 2, 3, 4, 5, 6, 7, 8])]);
    expect(checkFile(noMoov, 'm4a')).toMatchObject({ ok: false, reason: 'no moov' });
    expect(checkFile(new Uint8Array(4), 'mp4').ok).toBe(false);
  });
  it('checks the start of Matroska, MP3, FLAC and WAV files', () => {
    const mkv = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01, 0x18, 0x53, 0x80, 0x67, 0, 0, 0, 0, 0, 0, 0]);
    expect(checkFile(mkv, 'mkv').ok).toBe(true);
    expect(checkFile(new Uint8Array(20), 'webm').ok).toBe(false);
    expect(checkFile(new Uint8Array([...enc.encode('ID3'), ...new Array(20).fill(0)]), 'mp3').ok).toBe(true);
    expect(checkFile(new Uint8Array([0xff, 0xfb, ...new Array(20).fill(0)]), 'mp3').ok).toBe(true);
    expect(checkFile(new Uint8Array([...enc.encode('fLaC'), ...new Array(20).fill(0)]), 'flac').ok).toBe(true);
    expect(checkFile(new Uint8Array([...enc.encode('RIFF'), 0, 0, 0, 0, ...enc.encode('WAVE'), ...new Array(12).fill(0)]), 'wav').ok).toBe(true);
  });
  it('checks that an Ogg file ends on a whole page', () => {
    const page = (body: number[]) => [...enc.encode('OggS'), ...new Array(22).fill(0), 1, body.length, ...body];
    const ogg = new Uint8Array([...page(new Array(30).fill(1)), ...page(new Array(10).fill(2))]);
    expect(checkFile(ogg, 'opus').ok).toBe(true);
    expect(checkFile(ogg.subarray(0, ogg.length - 3), 'ogg')).toMatchObject({ ok: false, reason: 'last page cut short' });
  });
  it('checks the end of pictures', () => {
    expect(checkFile(new Uint8Array([0xff, 0xd8, ...new Array(20).fill(0), 0xff, 0xd9]), 'jpg').ok).toBe(true);
    expect(checkFile(new Uint8Array([0xff, 0xd8, ...new Array(20).fill(0)]), 'jpg').ok).toBe(false);
    expect(checkFile(new Uint8Array([...enc.encode('GIF89a'), ...new Array(20).fill(0), 0x3b]), 'gif').ok).toBe(true);
    const webp = new Uint8Array([...enc.encode('RIFF'), 12, 0, 0, 0, ...enc.encode('WEBP'), ...new Array(8).fill(0)]);
    expect(checkFile(webp, 'webp').ok).toBe(true);
    expect(checkFile(webp.subarray(0, 18), 'webp').ok).toBe(false);
  });
  it('trusts what it does not read, and sizes a little apart', () => {
    expect(checkFile(new Uint8Array(32), 'avi').ok).toBe(true);
    expect(sizeMatches(1_000_000, 1_000_500)).toBe(true);
    expect(sizeMatches(900_000, 1_000_000)).toBe(false);
    expect(sizeMatches(5, undefined)).toBe(true);
  });
});

/* ----------------------------------------------------- « Réglages synchronisés » */
describe('sync', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, sync: true, tourDone: true };
  it('leaves what is of this computer out, in one piece', () => {
    const out = toSynced(s);
    expect(Object.keys(out)).toEqual([`${SYNC_PREFIX}settings`]);
    const plain = out[`${SYNC_PREFIX}settings`] as Record<string, unknown>;
    expect(plain.sync).toBeUndefined();
    expect(plain.tourDone).toBeUndefined();
    expect(plain.theme).toBe(s.theme);
  });
  it('comes back whole, without what Grabby no longer has', () => {
    const back = fromSynced(toSynced(s))!;
    expect(back.sync).toBeUndefined();
    expect(back.theme).toBe(s.theme);
    expect(fromSynced({})).toBeUndefined();
    // Synced by an older version: its rules per site and AI choices stay out.
    expect(fromSynced({ [`${SYNC_PREFIX}settings`]: { theme: s.theme, rules: [{ site: 'a.test' }], aiModels: true, chromeAi: true, sync: true } })).toEqual({ theme: s.theme });
  });
  it('tells the rule pieces of older versions as no longer used', () => {
    const before = { [`${SYNC_PREFIX}settings`]: {}, [`${SYNC_PREFIX}rules.n`]: 2, [`${SYNC_PREFIX}rules.0`]: [], [`${SYNC_PREFIX}rules.1`]: [], other: 1 };
    expect(staleKeys(before, toSynced(s)).sort()).toEqual([`${SYNC_PREFIX}rules.0`, `${SYNC_PREFIX}rules.1`, `${SYNC_PREFIX}rules.n`]);
    expect(staleKeys(toSynced(s), toSynced(s))).toEqual([]);
  });
});

/* ------------------------------------------------------------- « gb » */
describe('omniboxRequest', () => {
  it('reads links typed without https and « son » first', () => {
    expect(omniboxRequest('son youtu.be/abcdefghijk')).toEqual({ urls: ['https://youtu.be/abcdefghijk'], mode: 'audio' });
    expect(omniboxRequest('https://a.test/x https://b.test/y').urls).toHaveLength(2);
    expect(omniboxRequest('hello').urls).toEqual([]);
  });
});

/* ------------------------------------------------------- « Déjà téléchargé » */
describe('savedBefore', () => {
  it('knows a YouTube video by its id, anything else by page and title', () => {
    expect(youTubeIdOf('https://www.youtube.com/shorts/abcdefghijk?x')).toBe('abcdefghijk');
    expect(youTubeIdOf('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    const yt = entry({ pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk&t=3' });
    const other = entry({ pageUrl: 'https://a.test/v', title: 'Le film' });
    const history = [entry({ pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk', filename: 'photo.png' }), yt, other];
    expect(savedBefore(history, { pageUrl: 'https://www.youtube.com/watch?v=abcdefghijk', title: '', ytId: 'abcdefghijk' })).toBe(yt);
    expect(savedBefore(history, { pageUrl: 'https://a.test/v', title: 'le FILM ' })).toBe(other);
    expect(savedBefore(history, { pageUrl: 'https://a.test/v', title: 'Un autre' })).toBeUndefined();
    expect(savedBefore([{ ...yt, missing: true }], { pageUrl: yt.pageUrl, title: '' })).toBeUndefined();
  });
  it('tells two videos of one page apart (same title, not the same video)', () => {
    const first = entry({ pageUrl: 'https://a.test/v', title: 'Page', media: 'one' });
    expect(savedBefore([first], { pageUrl: 'https://a.test/v', title: 'Page', id: 'one' })).toBe(first);
    expect(savedBefore([first], { pageUrl: 'https://a.test/v', title: 'Page', id: 'two' })).toBeUndefined();
    // Saved before the id was kept: page and title still tell.
    expect(savedBefore([{ ...first, media: undefined }], { pageUrl: 'https://a.test/v', title: 'Page', id: 'two' })).toBeTruthy();
  });
});

/* ------------------------------------------------------- « Diagnostic clair » */
describe('report', () => {
  const job = { id: 'j', tabId: 1, mediaId: 'm', mode: 'video', status: 'error', error: 'http_403', progress: 0.42, bytes: 420, speed: 0, filename: 'Mon film secret.mp4', title: 'Mon film secret', pageUrl: 'https://www.example.com/private/path?token=abc', kind: 'hls', startedAt: 0, format: 'mp4', quality: '1080p', attempts: 2 } as Job;
  it('tells the site, never the address nor the title', () => {
    const r = reportOf(job, { version: '2.0.0', browser: 'Chrome 141', system: 'Windows', lang: 'fr', now: 0 });
    expect(r).toContain('Site: www.example.com');
    expect(r).toContain('Error: http_403');
    expect(r).toContain('Attempts: 2');
    expect(r).not.toMatch(/private|token|secret/);
  });
  it('names the browser and the system', () => {
    expect(browserName('', [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141' }])).toBe('Chrome 141');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('Edge 141');
    expect(systemName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS');
  });
});

/* -------------------------------------------- « Son plus propre », faster encoding */
describe('finish 2.0', () => {
  it('keeps « son plus propre » unless the sound is taken away', () => {
    expect(cleanEdit({ clean: true }, true)).toEqual({ clean: true });
    expect(cleanEdit({ clean: true, mute: true }, false)).toEqual({ mute: true });
    expect(audioFilters({ clean: true, speed: 4 })).toEqual([...CLEAN_SOUND, 'atempo=2', 'atempo=2']);
  });
  it('cleans the sound of a sound file', () => {
    const [first] = encodeAttempts({ input: 'in.m4a', outBase: 'out', ext: 'm4a', audioOnly: true, edit: { clean: true } });
    expect(first!.args.join(' ')).toContain(`-af ${CLEAN_SOUND.join(',')}`);
  });
  it('never copies the sound it cleans; encodes faster when no size is aimed at', () => {
    const tries = encodeAttempts({ input: 'in.mp4', outBase: 'out', ext: 'mp4', audioOnly: false, edit: { clean: true } });
    expect(tries.some((t) => t.args.join(' ').includes('-c:a copy'))).toBe(false);
    expect(tries[0]!.args.join(' ')).toContain('-preset superfast');
    const sized = encodeAttempts({ input: 'in.mp4', outBase: 'out', ext: 'mp4', audioOnly: false, compress: 25, duration: 60 });
    expect(sized[0]!.args.join(' ')).toContain('-preset veryfast');
    const plain = encodeAttempts({ input: 'in.mp4', outBase: 'out', ext: 'mp4', audioOnly: false, edit: { flip: true } });
    expect(plain[0]!.args.join(' ')).toContain('-c:a copy');
  });
});

describe('checkFile leniency', () => {
  it('lets junk after whole boxes be, and old QuickTime files without ftyp', () => {
    const whole = mp4();
    expect(checkFile(new Uint8Array([...whole, 0, 0, 0]), 'mp4').ok).toBe(true);
    expect(checkFile(new Uint8Array([...whole, 0xff, 0xfe, 0xfd, 0xfc, 0, 0, 0, 0, 1, 2]), 'mp4').ok).toBe(true);
    const qt = new Uint8Array([...box('wide'), ...whole.subarray(16)]);
    expect(checkFile(qt, 'mov').ok).toBe(true);
    expect(checkFile(enc.encode('<!doctype html><html>Not found</html>'), 'mp4').ok).toBe(false);
  });
});
