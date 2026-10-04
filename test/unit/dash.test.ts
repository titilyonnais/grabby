import { describe, expect, it } from 'vitest';
import { parseDash } from '../../src/parsers/dash';
import { parseXml, child, children } from '../../src/parsers/xml';

describe('parseXml', () => {
  it('parses elements, attributes, namespaces, self-closing tags, comments and CDATA', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- c --><mpd:MPD xmlns:mpd="urn:x" a="1" b=\'two &amp; three\'><Period><BaseURL>http://x/</BaseURL><Empty/><![CDATA[ignored]]></Period></mpd:MPD>',
    );
    expect(root.name).toBe('MPD');
    expect(root.attrs).toMatchObject({ a: '1', b: 'two & three' });
    const period = child(root, 'Period')!;
    expect(child(period, 'BaseURL')!.text).toBe('http://x/');
    expect(children(period, 'Empty')).toHaveLength(1);
  });
});

const TEMPLATE_NUMBER = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT0H0M10.0S" minBufferTime="PT2S">
  <BaseURL>media/</BaseURL>
  <Period>
    <AdaptationSet mimeType="video/mp4" contentType="video">
      <SegmentTemplate initialization="init-$RepresentationID$.m4s" media="chunk-$RepresentationID$-$Number%05d$.m4s" startNumber="1" duration="4000" timescale="1000"/>
      <Representation id="v720" bandwidth="2000000" width="1280" height="720" codecs="avc1.64001f"/>
      <Representation id="v360" bandwidth="600000" width="640" height="360" codecs="avc1.4d401e"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" lang="en">
      <Representation id="a1" bandwidth="128000" codecs="mp4a.40.2">
        <SegmentTemplate initialization="a/init.mp4" media="a/$Number$.m4s" duration="2" startNumber="0"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

describe('parseDash', () => {
  it('expands SegmentTemplate with $Number$ and padding', () => {
    const m = parseDash(TEMPLATE_NUMBER, 'https://cdn.x.com/v/manifest.mpd');
    expect(m.dynamic).toBe(false);
    expect(m.protected).toBe(false);
    expect(m.duration).toBe(10);
    expect(m.video.map((r) => r.id)).toEqual(['v720', 'v360']);
    const v = m.video[0]!;
    expect(v).toMatchObject({ width: 1280, height: 720, bandwidth: 2000000, codecs: 'avc1.64001f', mimeType: 'video/mp4' });
    expect(v.init).toEqual({ url: 'https://cdn.x.com/v/media/init-v720.m4s' });
    expect(v.segments.map((s) => s.url)).toEqual([
      'https://cdn.x.com/v/media/chunk-v720-00001.m4s',
      'https://cdn.x.com/v/media/chunk-v720-00002.m4s',
      'https://cdn.x.com/v/media/chunk-v720-00003.m4s',
    ]);
    const a = m.audio[0]!;
    expect(a.lang).toBe('en');
    expect(a.segments).toHaveLength(5);
    expect(a.segments[0]!.url).toBe('https://cdn.x.com/v/media/a/0.m4s');
  });

  it('expands SegmentTimeline with $Time$ and repeats', () => {
    const xml = `<MPD type="static" mediaPresentationDuration="PT6S"><Period>
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <SegmentTemplate timescale="90000" initialization="$Bandwidth$/init.mp4" media="$Bandwidth$/t$Time$.m4s">
          <SegmentTimeline><S t="0" d="180000" r="1"/><S d="90000"/><S d="90000" r="-1"/></SegmentTimeline>
        </SegmentTemplate>
        <Representation id="1" bandwidth="500000" width="320" height="180"/>
      </AdaptationSet></Period></MPD>`;
    const m = parseDash(xml, 'https://h.com/a/b.mpd');
    expect(m.video[0]!.segments.map((s) => s.url)).toEqual([
      'https://h.com/a/500000/t0.m4s',
      'https://h.com/a/500000/t180000.m4s',
      'https://h.com/a/500000/t360000.m4s',
      'https://h.com/a/500000/t450000.m4s',
    ]);
  });

  it('supports SegmentList and SegmentBase', () => {
    const xml = `<MPD mediaPresentationDuration="PT4S"><Period>
      <AdaptationSet mimeType="video/mp4">
        <Representation id="list" bandwidth="1" height="240">
          <SegmentList><Initialization sourceURL="init.mp4" range="0-99"/><SegmentURL media="s1.mp4"/><SegmentURL media="s2.mp4" mediaRange="100-199"/></SegmentList>
        </Representation>
        <Representation id="base" bandwidth="2" height="480"><BaseURL>https://other.com/full.mp4</BaseURL><SegmentBase indexRange="800-999"/></Representation>
      </AdaptationSet></Period></MPD>`;
    const m = parseDash(xml, 'https://h.com/x.mpd');
    const list = m.video.find((r) => r.id === 'list')!;
    expect(list.init).toEqual({ url: 'https://h.com/init.mp4', range: [0, 99] });
    expect(list.segments).toEqual([{ url: 'https://h.com/s1.mp4' }, { url: 'https://h.com/s2.mp4', range: [100, 199] }]);
    const base = m.video.find((r) => r.id === 'base')!;
    expect(base.init).toBeUndefined();
    expect(base.segments).toEqual([{ url: 'https://other.com/full.mp4' }]);
  });

  it('flags ContentProtection and dynamic manifests', () => {
    const xml = `<MPD type="dynamic"><Period><AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
      <Representation id="1" bandwidth="1"><BaseURL>v.mp4</BaseURL></Representation>
    </AdaptationSet></Period></MPD>`;
    const m = parseDash(xml, 'https://h.com/x.mpd');
    expect(m.protected).toBe(true);
    expect(m.dynamic).toBe(true);
  });

  it('classifies audio by codecs when mimeType is missing on AdaptationSet', () => {
    const xml = `<MPD mediaPresentationDuration="PT2S"><Period><AdaptationSet>
      <Representation id="a" bandwidth="64000" mimeType="audio/mp4" codecs="mp4a.40.2"><BaseURL>a.mp4</BaseURL></Representation>
      <Representation id="v" bandwidth="64000" codecs="avc1.4d401e" width="2" height="2"><BaseURL>v.mp4</BaseURL></Representation>
    </AdaptationSet></Period></MPD>`;
    const m = parseDash(xml, 'https://h.com/x.mpd');
    expect(m.audio.map((r) => r.id)).toEqual(['a']);
    expect(m.video.map((r) => r.id)).toEqual(['v']);
  });
});
