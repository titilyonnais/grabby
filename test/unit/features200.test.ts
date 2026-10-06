import { describe, expect, it } from 'vitest';
import { checkFile, mp4Boxes, sizeMatches } from '../../src/shared/verify';
import { editedTranscript, exportTranscript, spokenHits, transcriptOf, type Transcript } from '../../src/shared/transcript';
import { nextTime, withLater } from '../../src/shared/later';
import { fromSynced, staleKeys, SYNC_PREFIX, toSynced } from '../../src/shared/sync';
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/settings';
import { omniboxRequest } from '../../src/shared/batch';
import { libraryNumbers, weekOf } from '../../src/shared/stats';
import { crc32, imageNames, keepImages, largestFromSrcset, zipStore } from '../../src/shared/images';
import { savedBefore, youTubeIdOf } from '../../src/shared/saved';
import { browserName, reportOf, systemName } from '../../src/shared/report';
import { feedLinkIn, feedUrl, parsePodcast } from '../../src/shared/feeds';
import { audioFilters, CLEAN_SOUND, cleanEdit, encodeAttempts } from '../../src/shared/finish';
import { collectionsOf, searchLibrary } from '../../src/app/sections/Library';
import { clockOf, resumeAt } from '../../src/app/sections/Player';
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

/* -------------------------------------------- « Chercher ce qui est dit », export */
describe('transcripts', () => {
  const said: Transcript = {
    cues: [
      { start: 1, end: 3, text: 'Bonjour à tous' },
      { start: 3.5, end: 6, text: "Aujourd'hui on parle d'énergie" },
      { start: 6, end: 9, text: 'solaire et du vent' },
    ],
  };
  it('keeps the words as said, the transcription first, without tags', () => {
    const t = transcriptOf([
      { cues: [{ start: 0, end: 1, text: 'translated' }], made: 'translated', lang: 'en' },
      { cues: [{ start: 0, end: 1, text: '<i>dit</i>  ici' }], made: 'transcribed', lang: 'fr' },
    ])!;
    expect(t).toEqual({ lang: 'fr', ai: true, cues: [{ start: 0, end: 1, text: 'dit ici' }] });
    expect(transcriptOf([])).toBeUndefined();
  });
  it('finds a phrase without accents, even over two lines', () => {
    expect(spokenHits(said, 'energie')).toEqual([{ at: 3.5, text: "Aujourd'hui on parle d'énergie" }]);
    expect(spokenHits(said, 'énergie solaire').map((h) => h.at)).toEqual([3.5]);
    expect(spokenHits(said, 'x')).toEqual([]);
  });
  it('exports subtitles, text and Markdown', () => {
    expect(exportTranscript(said, 'srt')).toContain('2\n00:00:03,500 --> 00:00:06,000\nAujourd');
    expect(exportTranscript(said, 'txt', 'Titre')).toBe("Titre\n\n[0:01] Bonjour à tous\n[0:03] Aujourd'hui on parle d'énergie\n[0:06] solaire et du vent\n");
    expect(exportTranscript(said, 'md', 'Titre')).toMatch(/^# Titre\n\n\*\*\[0:01\]\*\* Bonjour/);
  });
  it('edits lines: moved, trimmed, the empty ones gone', () => {
    const t = editedTranscript(said, [{ start: 1, end: 3, text: '  Salut  ' }, { start: 3.5, end: 6, text: '' }, { start: 0.2, end: 1, text: 'avant' }], -0.5);
    expect(t.cues).toEqual([
      { start: 0.5, end: 2.5, text: 'Salut' },
      { start: 0, end: 0.5, text: 'avant' },
    ]);
  });
});

/* --------------------------------------------------- « À télécharger plus tard » */
describe('later', () => {
  it('keeps a page once, the latest first', () => {
    let list = withLater([], { url: 'https://a.test/1', title: 'Un', mode: 'auto' }, 1);
    list = withLater(list, { url: 'https://a.test/2', title: 'Deux', mode: 'audio' }, 2);
    list = withLater(list, { url: 'https://a.test/1', title: 'Un encore', mode: 'auto' }, 3);
    expect(list.map((l) => l.title)).toEqual(['Un encore', 'Deux']);
    expect(list[0]!.added).toBe(3);
  });
  it('plans the next time of day', () => {
    const now = new Date(2026, 9, 6, 22, 30);
    expect(new Date(nextTime(23 * 60, now)).getDate()).toBe(6);
    expect(new Date(nextTime(2 * 60, now)).getDate()).toBe(7);
    expect(new Date(nextTime(22 * 60 + 30, now)).getDate()).toBe(7);
  });
});

/* ----------------------------------------------------- « Réglages synchronisés » */
describe('sync', () => {
  const s: Settings = { ...DEFAULT_SETTINGS, sync: true, tourDone: true, rules: Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, site: `site${i}.example`, mode: 'audio' as const, quality: 'best', subs: [], folder: 'Dossier '.repeat(4) })) };
  it('leaves what is of this computer out and cuts the rules in pieces', () => {
    const out = toSynced(s);
    const plain = out[`${SYNC_PREFIX}settings`] as Record<string, unknown>;
    expect(plain.sync).toBeUndefined();
    expect(plain.tourDone).toBeUndefined();
    expect(plain.rules).toBeUndefined();
    const n = out[`${SYNC_PREFIX}rules.n`] as number;
    expect(n).toBeGreaterThan(1);
    for (let i = 0; i < n; i++) expect(JSON.stringify(out[`${SYNC_PREFIX}rules.${i}`]).length).toBeLessThanOrEqual(7000);
  });
  it('comes back whole, and tells the pieces no longer used', () => {
    const out = toSynced(s);
    const back = fromSynced(out)!;
    expect(back.rules).toHaveLength(120);
    expect(back.sync).toBeUndefined();
    expect(back.theme).toBe(s.theme);
    expect(fromSynced({})).toBeUndefined();
    const fewer = toSynced({ ...s, rules: [] });
    expect(staleKeys(out, fewer).every((k) => k.startsWith(`${SYNC_PREFIX}rules.`))).toBe(true);
    expect(staleKeys(out, fewer).length).toBe(out[`${SYNC_PREFIX}rules.n`]);
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

/* ------------------------------------------------------------ statistics */
describe('libraryNumbers', () => {
  const now = new Date(2026, 9, 7, 18).getTime();
  const day = (d: number, h = 20) => new Date(2026, 9, d, h).getTime();
  const list = [
    entry({ date: day(7), pageUrl: 'https://www.youtube.com/watch?v=1', filename: 'a.mp4', size: 100 }),
    entry({ date: day(6), pageUrl: 'https://www.youtube.com/watch?v=2', filename: 'b.m4a', size: 50, mode: 'audio' }),
    entry({ date: day(5), pageUrl: 'https://vimeo.com/3', filename: 'c.png', size: 10 }),
    entry({ date: day(1, 9), pageUrl: 'https://vimeo.com/4', filename: 'd.mp4', size: 40 }),
    entry({ date: new Date(2026, 7, 1).getTime(), pageUrl: 'file:///x', filename: 'e.mp4', size: 1 }),
  ];
  const n = libraryNumbers(list, now, 12);
  it('counts files, room, kinds, sites and formats', () => {
    expect(n.files).toBe(5);
    expect(n.bytes).toBe(201);
    expect(n.kinds.audio).toEqual({ n: 1, bytes: 50 });
    expect(n.kinds.image.n).toBe(1);
    expect(n.sites.map((s) => s.site)).toEqual(['youtube.com', 'vimeo.com']);
    expect(n.formats[0]).toEqual({ format: 'mp4', n: 3 });
    expect(n.hour).toBe(20);
  });
  it('counts the weeks and the days in a row', () => {
    expect(n.week).toBe(3);
    expect(n.perWeek).toHaveLength(12);
    expect(n.perWeek[11]).toBe(3);
    expect(n.perWeek[10]).toBe(1);
    expect(n.streak).toEqual({ best: 3, now: 3 });
    expect(new Date(weekOf(now)).getDay()).toBe(1);
  });
});

/* ------------------------------------------------------ « Toutes les images » */
describe('images', () => {
  it('takes the biggest picture of a srcset', () => {
    expect(largestFromSrcset('a.jpg 480w, b.jpg 1080w, c.jpg 720w', 'https://x.test/p/')).toBe('https://x.test/p/b.jpg');
    expect(largestFromSrcset('a.jpg 1x, b.jpg 2x', 'https://x.test/')).toBe('https://x.test/b.jpg');
  });
  it('keeps real pictures once each, not the tiny ones', () => {
    const kept = keepImages([
      { url: 'https://x.test/a.jpg', w: 800, h: 600 },
      { url: 'https://x.test/a.jpg', w: 0, h: 0 },
      { url: 'https://x.test/icon.png', w: 16, h: 16 },
      { url: 'javascript:alert(1)', w: 0, h: 0 },
      { url: 'data:image/png;base64,AAAA', w: 100, h: 100 },
    ]);
    expect(kept.map((i) => i.url)).toEqual(['https://x.test/a.jpg', 'data:image/png;base64,AAAA']);
    expect(kept[0]!.w).toBe(800);
  });
  it('names files once each', () => {
    expect(imageNames([{ url: 'https://x.test/photo.JPEG' }, { url: 'https://y.test/photo.jpeg?x=1' }, { url: 'data:image/png;base64,AA', type: 'image/png' }, { url: 'https://z.test/', type: 'image/webp' }])).toEqual([
      'photo.jpg',
      'photo (2).jpg',
      'image-3.png',
      'image-4.webp',
    ]);
  });
  it('makes a .zip any unzip tool reads', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    const zip = zipStore([
      { name: 'a.txt', data: enc.encode('hello') },
      { name: 'é.txt', data: enc.encode('world!') },
    ]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const dirAt = view.getUint32(end + 16, true);
    expect(view.getUint32(dirAt, true)).toBe(0x02014b50);
    expect(view.getUint32(dirAt + 16, true)).toBe(crc32(enc.encode('hello')));
    // The second file's header is where the directory says.
    const second = dirAt + 46 + 5;
    expect(view.getUint32(second + 42, true)).toBe(30 + 5 + 5);
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

/* ------------------------------------------------------------- podcasts */
describe('parsePodcast', () => {
  const rss = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
    <title><![CDATA[Le podcast]]></title><link>https://pod.test/</link><itunes:image href="https://pod.test/cover.jpg"/>
    <item><title>Épisode 2</title><guid>ep-2</guid><pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate>
      <enclosure url="https://cdn.pod.test/ep2.mp3?x=1" type="audio/mpeg" length="1"/><link>https://pod.test/2</link></item>
    <item><title>Épisode 1</title><pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate><enclosure url="https://cdn.pod.test/ep1.m4a" type="audio/x-m4a"/></item>
    <item><title>Un article</title><link>https://pod.test/a</link></item>
  </channel></rss>`;
  it('reads a podcast: title, picture, site and episodes with their files', () => {
    const p = parsePodcast(rss, 'https://pod.test/feed.xml')!;
    expect(p.title).toBe('Le podcast');
    expect(p.image).toBe('https://pod.test/cover.jpg');
    expect(p.site).toBe('https://pod.test/');
    expect(p.entries.map((e) => e.title)).toEqual(['Épisode 2', 'Épisode 1']);
    expect(p.entries[0]).toMatchObject({ id: 'ep-2', url: 'https://cdn.pod.test/ep2.mp3?x=1', link: 'https://pod.test/2', audio: true });
    expect(p.entries[1]!.id).toBe('https://cdn.pod.test/ep1.m4a');
    expect(feedUrl('feed', 'https://pod.test/feed.xml')).toBe('https://pod.test/feed.xml');
  });
  it('reads Atom enclosures, and leaves feeds without files', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Vidéos</title><entry><id>tag:1</id><title>Une</title><updated>2026-10-06T00:00:00Z</updated>
      <link rel="enclosure" href="https://v.test/1.mp4" type="video/mp4"/><link href="https://v.test/1"/></entry></feed>`;
    const p = parsePodcast(atom)!;
    expect(p.entries[0]).toMatchObject({ id: 'tag:1', url: 'https://v.test/1.mp4', link: 'https://v.test/1' });
    expect(p.entries[0]!.audio).toBeUndefined();
    expect(parsePodcast('<rss><channel><title>Blog</title><item><title>x</title></item></channel></rss>')).toBeNull();
    expect(parsePodcast('<html>no</html>')).toBeNull();
  });
  it('finds the feed a page names', () => {
    const html = '<head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed?a=1&amp;b=2"></head>';
    expect(feedLinkIn(html, 'https://pod.test/show')).toBe('https://pod.test/feed?a=1&b=2');
    expect(feedLinkIn('<link rel="stylesheet" href="/a.css">', 'https://pod.test/')).toBeUndefined();
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

/* -------------------------------------------------------------- library */
describe('library', () => {
  const a = entry({ id: 'a', title: 'Recette de crêpes', tags: ['Cuisine', 'Favoris'], text: true });
  const b = entry({ id: 'b', title: 'Concert', tags: ['Cuisine'] });
  const c = entry({ id: 'c', title: 'Autre' });
  it('lists collections, the biggest first', () => {
    expect(collectionsOf([a, b, c])).toEqual([
      { name: 'Cuisine', n: 2 },
      { name: 'Favoris', n: 1 },
    ]);
  });
  it('finds files by title and by what is said in them', () => {
    const texts = { c: { cues: [{ start: 65, end: 70, text: 'on ajoute la farine' }] } };
    const { shown, hits } = searchLibrary([a, b, c], 'farine', texts);
    expect(shown.map((e) => e.id)).toEqual(['c']);
    expect(hits.get('c')).toEqual([{ at: 65, text: 'on ajoute la farine' }]);
    expect(searchLibrary([a, b, c], 'crepes', texts).shown.map((e) => e.id)).toEqual(['a']);
    expect(searchLibrary([a, b], '', texts).shown).toHaveLength(2);
  });
  it('takes up where it was left, not at the very start or end', () => {
    expect(resumeAt(120, 600)).toBe(120);
    expect(resumeAt(3, 600)).toBeUndefined();
    expect(resumeAt(595, 600)).toBeUndefined();
    expect(resumeAt(undefined, 600)).toBeUndefined();
    expect(clockOf(65)).toBe('1:05');
    expect(clockOf(3725)).toBe('1:02:05');
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
