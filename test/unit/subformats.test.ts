import { describe, expect, it } from 'vitest';
import { describeFormats } from '../../src/features/youtube-hook';
import { captionsFromUrl, hiddenPlayerUrl, hiddenSessionFromUrl } from '../../src/features/youtube';
import { parseDash } from '../../src/parsers/dash';
import { mergeKeep, SESSION_SPAN, sessionOf } from '../../src/shared/idb';
import { mp4Cues, readInit, readSamples } from '../../src/shared/mp4subs';
import { mp4End, settle, storedEnd, untangle, webmClusters, webmEnd, type Fragment } from '../../src/shared/mediatime';
import { cuesOf, describeSubtitleUrl, isSubtitleFile, segmentPattern } from '../../src/shared/subtitles';
import { parseTtml, ttmlTime } from '../../src/shared/ttml';

/* ---------- a tiny MP4 writer, just enough for subtitle tracks ---------- */
const enc = new TextEncoder();
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u64 = (n: number) => [...u32(Math.floor(n / 2 ** 32)), ...u32(n >>> 0)];
const cat = (...parts: (number[] | Uint8Array)[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const box = (type: string, ...body: (number[] | Uint8Array)[]) => {
  const inner = cat(...body);
  return cat(u32(inner.length + 8), enc.encode(type), inner);
};
const full = (type: string, version: number, flags: number, ...body: (number[] | Uint8Array)[]) =>
  box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...body);

function init(format: 'wvtt' | 'stpp', timescale: number, defaultDuration = 0): Uint8Array {
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(0), [0, 0, 0, 0]);
  const entry = box(format, [0, 0, 0, 0, 0, 0, 0, 1]);
  const stsd = full('stsd', 0, 0, u32(1), entry);
  const trak = box('trak', box('mdia', mdhd, box('minf', box('stbl', stsd))));
  const mvex = box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(defaultDuration), u32(0), u32(0)));
  return cat(box('ftyp', enc.encode('iso6'), u32(0)), box('moov', trak, mvex));
}

/** One fragment: samples given as [duration, payload]. */
function fragment(decodeTime: number, samples: [number, Uint8Array][]): Uint8Array {
  const flags = 0x1 | 0x100 | 0x200;
  const build = (offset: number) => {
    const trun = full('trun', 0, flags, u32(samples.length), u32(offset), ...samples.flatMap(([d, p]) => [u32(d), u32(p.length)]));
    const traf = box('traf', full('tfhd', 0, 0x20000, u32(1)), full('tfdt', 1, 0, u64(decodeTime)), trun);
    return box('moof', full('mfhd', 0, 0, u32(1)), traf);
  };
  // The data offset counts from the start of moof (default-base-is-moof) to the mdat payload.
  const size = build(0).length;
  const moof = build(size + 8);
  return cat(moof, box('mdat', ...samples.map(([, p]) => p)));
}

const vttc = (text: string) => box('vttc', box('payl', enc.encode(text)));
const vtte = () => box('vtte');

describe('MP4 subtitles (wvtt)', () => {
  it('reads the timescale and the kind of track', () => {
    expect(readInit(init('wvtt', 1000))).toEqual({ format: 'wvtt', timescale: 1000, defaultDuration: 0 });
    expect(readInit(init('stpp', 90000, 3000)).format).toBe('stpp');
    expect(readInit(new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101])).format).toBe('other');
  });

  it('turns samples into cues, joining a line split over samples and skipping empty ones', () => {
    const seg1 = fragment(0, [
      [1000, vtte()],
      [1500, vttc('Bonjour')],
      [500, cat(vttc('Bonjour'), vttc('<i>Salut</i>'))],
    ]);
    const seg2 = fragment(3000, [[2000, vttc('Au revoir &amp; merci')]]);
    expect(mp4Cues(init('wvtt', 1000), [seg1, seg2])).toEqual([
      { start: 1, end: 3, text: 'Bonjour' },
      { start: 2.5, end: 3, text: '<i>Salut</i>' },
      { start: 3, end: 5, text: 'Au revoir & merci' },
    ]);
  });

  it('puts HLS fMP4 subtitles on the stream clock (first sample = start)', () => {
    const parts = [init('wvtt', 1000), fragment(10_000, [[1000, vttc('Un')]]), fragment(11_000, [[1000, vttc('Deux')]])];
    expect(cuesOf(parts, 'fmp4', { fromFirst: true }).map((c) => [c.start, c.text])).toEqual([
      [0, 'Un'],
      [1, 'Deux'],
    ]);
    expect(cuesOf(parts, 'fmp4', { shift: -10 }).map((c) => c.start)).toEqual([0, 1]);
  });
});

describe('TTML', () => {
  it('reads every kind of time', () => {
    const r = { frame: 25, tick: 10_000_000 };
    expect(ttmlTime('00:01:02.500', r)).toBe(62.5);
    expect(ttmlTime('00:00:01:05', r)).toBe(1.2);
    expect(ttmlTime('62.5s', r)).toBe(62.5);
    expect(ttmlTime('1500ms', r)).toBe(1.5);
    expect(ttmlTime('2m', r)).toBe(120);
    expect(ttmlTime('50f', r)).toBe(2);
    expect(ttmlTime('25000000t', r)).toBe(2.5);
    expect(ttmlTime('nope', r)).toBeUndefined();
  });

  it('keeps line breaks, italics and bold, and shifts by the div', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" ttp:tickRate="10000000" xmlns:ttp="http://www.w3.org/ns/ttml#parameter">
  <head><styling><style xml:id="it" tts:fontStyle="italic"/></styling></head>
  <body><div begin="10s">
    <p begin="10000000t" end="20000000t">Première<br/>ligne</p>
    <p begin="00:00:03.000" dur="1s"><span style="it">penché</span> et <span tts:fontWeight="bold">gras</span> &amp; fin</p>
  </div></body>
</tt>`;
    expect(parseTtml(xml)).toEqual([
      { start: 11, end: 12, text: 'Première\nligne' },
      { start: 13, end: 14, text: '<i>penché</i> et <b>gras</b> & fin' },
    ]);
  });

  it('reads timing put on spans', () => {
    const xml = '<tt><body><div><p><span begin="1s" end="2s">A</span><span begin="2s" end="3s">B</span></p></div></body></tt>';
    expect(parseTtml(xml).map((c) => [c.start, c.text])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);
  });

  it('is recognised in a subtitle file and in MP4 (stpp)', () => {
    const doc = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:02.000">Salut</p></div></body></tt>';
    expect(cuesOf([enc.encode(doc)], 'vtt')).toEqual([{ start: 1, end: 2, text: 'Salut' }]);
    const late = '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:05.000" end="00:00:06.000">Plus tard</p></div></body></tt>';
    const cues = mp4Cues(init('stpp', 1000), [fragment(0, [[4000, enc.encode(doc)]]), fragment(4000, [[4000, enc.encode(late)]])]);
    expect(cues).toEqual([
      { start: 1, end: 2, text: 'Salut' },
      { start: 5, end: 6, text: 'Plus tard' },
    ]);
  });

  it('places documents that count from their own sample', () => {
    const doc = '<tt><body><div><p begin="0.5s" end="1.5s">Relatif</p></div></body></tt>';
    expect(mp4Cues(init('stpp', 1000), [fragment(20_000, [[2000, enc.encode(doc)]])])).toEqual([{ start: 20.5, end: 21.5, text: 'Relatif' }]);
  });
});

describe('DASH text tracks', () => {
  const mpd = (set: string) => `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT8S">
 <Period>
  <AdaptationSet contentType="video" mimeType="video/mp4"><Representation id="v" bandwidth="1000" width="640" height="360" codecs="avc1.4d401e">
   <SegmentTemplate media="v$Number$.m4s" initialization="v-init.mp4" duration="4" startNumber="1"/></Representation></AdaptationSet>
  ${set}
 </Period>
</MPD>`;

  it('knows subtitles packed in MP4 (wvtt, stpp) from plain ones, with their offset', () => {
    const wvtt = parseDash(
      mpd(`<AdaptationSet contentType="text" mimeType="application/mp4" lang="fr"><Representation id="s1" bandwidth="1" codecs="wvtt">
   <SegmentTemplate media="s$Number$.m4s" initialization="s-init.mp4" duration="4000" timescale="1000" presentationTimeOffset="2000" startNumber="1"/></Representation></AdaptationSet>`),
      'https://cdn.test/a.mpd',
    ).text[0]!;
    expect(wvtt).toMatchObject({ packing: 'fmp4', pto: 2 });
    expect(wvtt.init).toEqual({ url: 'https://cdn.test/s-init.mp4' });
    const stpp = parseDash(
      mpd(`<AdaptationSet contentType="text" mimeType="application/mp4" lang="de"><Representation id="s2" bandwidth="1" codecs="stpp.ttml.im1t">
   <SegmentTemplate media="t$Number$.m4s" initialization="t-init.mp4" duration="4" startNumber="1"/></Representation></AdaptationSet>`),
      'https://cdn.test/a.mpd',
    ).text[0]!;
    expect(stpp.packing).toBe('fmp4');
    const ttml = parseDash(
      mpd(`<AdaptationSet mimeType="application/ttml+xml" lang="es"><Representation id="s3" bandwidth="1"><BaseURL>subs/es.ttml</BaseURL></Representation></AdaptationSet>`),
      'https://cdn.test/a.mpd',
    ).text[0]!;
    expect(ttml.packing).toBe('text');
    expect(ttml.segments[0]!.url).toBe('https://cdn.test/subs/es.ttml');
  });
});

describe('subtitle files a page loads', () => {
  it('are known by type or by name', () => {
    expect(isSubtitleFile('https://a.test/x', 'text/vtt; charset=utf-8')).toBe(true);
    expect(isSubtitleFile('https://a.test/subs/fr.srt')).toBe(true);
    expect(isSubtitleFile('https://a.test/subs/movie.dfxp?x=1')).toBe(true);
    expect(isSubtitleFile('https://a.test/video.mp4', 'video/mp4')).toBe(false);
    expect(isSubtitleFile('not a url')).toBe(false);
  });

  it('get a name and a language from their address', () => {
    expect(describeSubtitleUrl('https://a.test/subs/movie_en-US.srt')).toEqual({ label: 'movie_en-US', lang: 'en-US' });
    expect(describeSubtitleUrl('https://a.test/fr.vtt')).toEqual({ label: 'fr', lang: 'fr' });
    expect(describeSubtitleUrl('https://a.test/api/subs?lang=de')).toMatchObject({ lang: 'de' });
    expect(describeSubtitleUrl('https://a.test/track.vtt')).toEqual({ label: 'track' });
  });

  it('tell the segments of a stream apart from whole files', () => {
    expect(segmentPattern('https://a.test/sub_00012.vtt?t=9')).toBe(segmentPattern('https://a.test/sub_00013.vtt'));
    expect(segmentPattern('https://a.test/fr.vtt')).not.toBe(segmentPattern('https://a.test/en.vtt'));
  });
});

describe('recording sessions', () => {
  it('keep only the last tracks a session named (a rebuilt player starts over in new ones)', () => {
    // Session 0 reported tracks 0 and 1, then the player rebuilt itself: 1040 and 1041.
    expect(mergeKeep([0, 1], [1040, 1041])).toEqual([1040, 1041]);
    // Another session's report leaves the first one alone.
    const s1 = SESSION_SPAN + 1040;
    expect(mergeKeep([1040, 1041], [s1, s1 + 1])).toEqual([1040, 1041, s1, s1 + 1]);
    expect(mergeKeep([1040], undefined)).toEqual([1040]);
    expect(mergeKeep(undefined, [3, 3])).toEqual([3]);
  });

  it('give each session its own track numbers', () => {
    expect(sessionOf(3)).toBe(0);
    expect(sessionOf(2 * SESSION_SPAN + 1)).toBe(2);
  });

  it('travel in the hidden player address, with the part and where to start again', () => {
    const url = hiddenPlayerUrl({ jobId: 'job-1', videoId: 'abc', quality: 'hd720', vcodec: 'avc', acodec: 'aac', session: 2, from: 61.8, part: { start: 30, end: 90 } });
    const q = new URL(url).searchParams;
    expect(q.get('gys')).toBe('2');
    expect(q.get('start')).toBe('61');
    expect(q.get('gyb')).toBe('30');
    expect(q.get('gye')).toBe('90');
    expect(hiddenSessionFromUrl(url)).toBe(2);
    const first = hiddenPlayerUrl({ jobId: 'job-1', videoId: 'abc', quality: 'hd720', vcodec: 'avc', acodec: 'aac' });
    expect(new URL(first).searchParams.has('start')).toBe(false);
    expect(hiddenSessionFromUrl(first)).toBe(0);
    expect(hiddenSessionFromUrl('https://www.youtube.com/embed/x?gys=-4')).toBe(0);
  });
});

describe('YouTube subtitles', () => {
  it('lists the player’s tracks as WebVTT, automatic ones marked', () => {
    const info = describeFormats({
      videoDetails: { videoId: 'abc', title: 'Clip', lengthSeconds: '60' },
      playabilityStatus: { status: 'OK', playableInEmbed: true },
      streamingData: { adaptiveFormats: [{ itag: 136, mimeType: 'video/mp4; codecs="avc1"', qualityLabel: '720p' }, { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"' }] },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: '/api/timedtext?v=abc&lang=fr', languageCode: 'fr', name: { simpleText: 'Français' } },
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr', languageCode: 'en', kind: 'asr', name: { runs: [{ text: 'English' }, { text: ' (auto)' }] } },
            { baseUrl: 'https://evil.test/timedtext', languageCode: 'de', name: { simpleText: 'Deutsch' } },
          ],
        },
      },
    } as Parameters<typeof describeFormats>[0])!;
    expect(info.captions).toEqual([
      { url: 'https://www.youtube.com/api/timedtext?v=abc&lang=fr&fmt=vtt', lang: 'fr', name: 'Français', auto: false },
      { url: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr&fmt=vtt', lang: 'en', name: 'English (auto)', auto: true },
    ]);
  });
});

describe('YouTube’s own subtitle formats', () => {
  it('json3: events with text, empty ones and line feeds dropped', () => {
    const json = JSON.stringify({
      wireMagic: 'pb3',
      events: [
        { tStartMs: 0, dDurationMs: 5000, id: 1, wpWinPosId: 1 },
        { tStartMs: 500, dDurationMs: 1300, segs: [{ utf8: 'Bonjour ' }, { utf8: 'à tous' }] },
        { tStartMs: 1800, dDurationMs: 10, aAppend: 1, segs: [{ utf8: '\n' }] },
        { tStartMs: 2500, dDurationMs: 1300, segs: [{ utf8: 'deux\nlignes' }] },
      ],
    });
    expect(cuesOf([enc.encode(json)], 'vtt')).toEqual([
      { start: 0.5, end: 1.8, text: 'Bonjour à tous' },
      { start: 2.5, end: 3.8, text: 'deux\nlignes' },
    ]);
  });

  it('srv3 and srv1 XML', () => {
    const srv3 = '<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="1000" d="1500">Salut <s>&amp; toi</s></p><p t="3000" d="500">a<br/>b</p></body></timedtext>';
    expect(cuesOf([enc.encode(srv3)], 'vtt')).toEqual([
      { start: 1, end: 2.5, text: 'Salut & toi' },
      { start: 3, end: 3.5, text: 'a\nb' },
    ]);
    const srv1 = '<?xml version="1.0" encoding="utf-8" ?><transcript><text start="1.5" dur="2">C&amp;#39;est fini</text></transcript>';
    expect(cuesOf([enc.encode(srv1)], 'vtt')).toEqual([{ start: 1.5, end: 3.5, text: "C'est fini" }]);
  });

  it('the hidden player is told which subtitles to switch on', () => {
    const q = new URL(hiddenPlayerUrl({ jobId: 'job-1', videoId: 'abc', quality: 'hd720', vcodec: 'avc', acodec: 'aac', captions: [{ lang: 'en', auto: true }, { lang: 'en', tlang: 'fr' }] })).searchParams;
    expect(q.get('gysc')).toBe('en.asr,en>fr');
    expect(captionsFromUrl(q.get('gysc'))).toEqual([{ lang: 'en', auto: true }, { lang: 'en', tlang: 'fr' }]);
    expect(captionsFromUrl('en.asr,<script>,x,fr')).toEqual([{ lang: 'en', auto: true }, { lang: 'fr' }]);
  });
});

describe('how far a recorded track got', () => {
  it('MP4: the end of the last fragment that came in full, from pieces cut anywhere', () => {
    const a = fragment(0, [
      [1000, vttc('a')],
      [500, vttc('b')],
    ]);
    const b = fragment(1500, [[700, vttc('c')]]);
    const head = init('wvtt', 1000);
    expect(mp4End(head, [a, b])).toBeCloseTo(2.2);
    // The last fragment cut short: it doesn't count.
    expect(mp4End(head, [a, b.subarray(0, b.length - 3)])).toBeCloseTo(1.5);
    // Pieces that start in the middle of a box: the next fragment is found.
    expect(mp4End(head, [a.subarray(5), b])).toBeCloseTo(2.2);
    expect(mp4End(head, [new Uint8Array(10)])).toBeUndefined();
  });

  it('WebM: the latest block of the last cluster, with the file’s time scale', () => {
    const info = new Uint8Array([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
    const cluster = (ms: number, rel: number) =>
      new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x82, ms >> 8, ms & 255, 0xa3, 0x85, 0x81, rel >> 8, rel & 255, 0x80, 0x00]);
    expect(webmEnd(info, [cluster(5000, 0), cluster(10000, 500)])).toBeCloseTo(10.5);
    // A block cut short is left out: the cluster's own time stands.
    expect(webmEnd(info, [cluster(10000, 500).subarray(0, 20)])).toBeCloseTo(10);
    expect(webmEnd(info, [new Uint8Array([1, 2, 3])])).toBeUndefined();
    expect(storedEnd('video/webm; codecs="vp9"', info, [cluster(2000, 40)])).toBeCloseTo(2.04);
  });
});

describe('a recorded track put back in order', () => {
  const piece = (time: number, until: number): Fragment => ({ at: 0, end: 0, time, until });

  it('keeps what the player buffer holds, in time order', () => {
    // Recorded from 216 s, then the player filled what it had skipped before (210–216 s),
    // then carried on after what it already had.
    const a = piece(216.033, 236.85);
    const b = piece(210.333, 216.017);
    const c = piece(236.867, 284);
    expect(settle([a, b, c])).toEqual([b, a, c]);
    // Appended again over a part already there: the new copy replaces it.
    const a2 = piece(216.033, 236.85);
    expect(settle([a, c, a2])).toEqual([a2, c]);
    // Going back further than everything: what it covers goes.
    const d = piece(200, 240);
    expect(settle([a, c, d])).toEqual([d, c]);
  });

  it('WebM clusters appended out of order come out in order', () => {
    const info = new Uint8Array([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
    const cluster = (ms: number) =>
      new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x82, ms >> 8, ms & 255, 0xa3, 0x85, 0x81, 0, 10, 0x80, 0x00]);
    const data = cat(info, cluster(5000), cluster(10000), cluster(2000), cluster(7000));
    expect(untangle('video/webm', data, info.length)).toEqual(cat(info, cluster(2000), cluster(5000), cluster(7000), cluster(10000)));
    // Already in order: the very same bytes.
    const sorted = cat(info, cluster(2000), cluster(5000));
    expect(untangle('video/webm', sorted, info.length)).toBe(sorted);
  });

  it('MP4 fragments appended twice are kept once', () => {
    const head = init('wvtt', 1000);
    const a = fragment(0, [
      [1000, vttc('a')],
      [500, vttc('b')],
    ]);
    const b = fragment(1500, [[700, vttc('c')]]);
    expect(untangle('video/mp4', cat(head, a, b, a, b), head.length)).toEqual(cat(head, a, b));
    expect(untangle('video/mp4', cat(head, b, a), head.length)).toEqual(cat(head, a, b));
    // Unreadable data is left as it is.
    const junk = cat(head, new Uint8Array(50));
    expect(untangle('video/mp4', junk, head.length)).toBe(junk);
  });

  it('MP4: a fragment appended over the end of another takes its place there', () => {
    const head = init('wvtt', 1000);
    // 0–3 s, then the player starts again at 2 s: the frame at 2 s is there only once.
    const a = fragment(0, [
      [1000, vttc('a')],
      [1000, vttc('b')],
      [1000, vttc('c')],
    ]);
    const b = fragment(2000, [
      [1000, vttc('C')],
      [1000, vttc('d')],
    ]);
    const out = untangle('video/mp4', cat(head, a, b), head.length);
    const info = readInit(head);
    expect(readSamples(out, info).map((s) => s.time)).toEqual([0, 1, 2, 3]);
    expect(mp4Cues(head, [out.subarray(head.length)]).map((c) => c.text)).toEqual(['a', 'b', 'C', 'd']);
    // Covering a whole fragment: it goes.
    const c = fragment(0, [[3000, vttc('x')]]);
    expect(readSamples(untangle('video/mp4', cat(head, a, c, b), head.length), info).map((s) => s.time)).toEqual([0, 2, 3]);
    // End to end: the very same bytes.
    const d = fragment(3000, [[1000, vttc('e')]]);
    const joined = cat(head, a, d);
    expect(untangle('video/mp4', joined, head.length)).toBe(joined);
  });

  it('WebM: a cluster appended over the end of another takes its place there', () => {
    const info = new Uint8Array([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
    const block = (rel: number) => [0xa3, 0x85, 0x81, rel >> 8, rel & 255, 0x80, 0x00];
    const cluster = (ms: number, rels: number[]) => {
      const body = [0xe7, 0x82, ms >> 8, ms & 255, ...rels.flatMap(block)];
      return new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 0, 0, 0, 0, 0, 0, body.length, ...body]);
    };
    const out = untangle('video/webm', cat(info, cluster(5000, [0, 500, 1000, 1500]), cluster(6000, [0, 500])), info.length);
    expect(out).toEqual(cat(info, cluster(5000, [0, 500]), cluster(6000, [0, 500])));
    expect(webmClusters(out, 1_000_000, info.length).map((c) => c.time)).toEqual([5, 6]);
  });

  it('how far a track got counts what the buffer holds after a jump back', () => {
    const head = init('wvtt', 1000);
    const late = fragment(5000, [[1000, vttc('x')]]);
    const early = fragment(0, [[1000, vttc('y')]]);
    expect(mp4End(head, [late, early])).toBeCloseTo(6);
  });
});
