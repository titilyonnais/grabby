import { describe, expect, it } from 'vitest';
import { describeFormats } from '../../src/features/youtube-hook';

const f = (itag: number, mimeType: string, qualityLabel?: string, contentLength?: number, fps?: number) => ({
  itag,
  mimeType,
  ...(qualityLabel ? { qualityLabel } : {}),
  ...(contentLength ? { contentLength: String(contentLength) } : {}),
  ...(fps ? { fps } : {}),
});

const response = (formats: ReturnType<typeof f>[], extra: Record<string, unknown> = {}) => ({
  videoDetails: { videoId: 'abc', title: 'Clip', lengthSeconds: '634' },
  playabilityStatus: { status: 'OK', playableInEmbed: true },
  streamingData: { adaptiveFormats: formats },
  ...extra,
});

const AAC = f(140, 'audio/mp4; codecs="mp4a.40.2"', undefined, 10);
const OPUS = f(251, 'audio/webm; codecs="opus"', undefined, 8);

describe('describeFormats', () => {
  it('lists the qualities that exist, best first, with sizes per format', () => {
    const info = describeFormats(
      response([
        f(137, 'video/mp4; codecs="avc1.640028"', '1080p', 1000),
        f(248, 'video/webm; codecs="vp9"', '1080p', 800),
        f(136, 'video/mp4; codecs="avc1.4d401f"', '720p', 500),
        f(313, 'video/webm; codecs="vp9"', '2160p', 5000),
        AAC,
        OPUS,
      ]),
    )!;
    expect(info.id).toBe('abc');
    expect(info.duration).toBe(634);
    expect(info.embeddable).toBe(true);
    expect(info.qualities.map((q) => q.label)).toEqual(['2160p', '1080p', '720p']);
    const [uhd, fhd, hd] = info.qualities;
    expect(uhd).toMatchObject({ quality: 'hd2160', avc: false, vp9: true, sizes: { mp4: 5010, webm: 5008 } });
    expect(fhd).toMatchObject({ quality: 'hd1080', avc: true, vp9: true, sizes: { mp4: 1010, webm: 808 } });
    // No VP9 at 720p: WebM isn't offered a size there.
    expect(hd!.sizes).toEqual({ mp4: 510 });
  });

  it('keeps the frame rate in the label', () => {
    const info = describeFormats(response([f(299, 'video/mp4; codecs="avc1.64002a"', '1080p60', 100, 60), f(137, 'video/mp4; codecs="avc1"', '1080p', 90, 30), AAC]))!;
    expect(info.qualities).toHaveLength(1);
    expect(info.qualities[0]!.label).toBe('1080p60');
  });

  it('without the format list (signed in), takes the qualities of its player menu', () => {
    const r = { videoDetails: { videoId: 'abc', title: 'Clip', lengthSeconds: '634' }, playabilityStatus: { status: 'OK', playableInEmbed: true } };
    expect(describeFormats(r)).toBeNull();
    const info = describeFormats(r, [
      { quality: 'hd2160', qualityLabel: '2160p60 HDR' },
      { quality: 'hd1080', qualityLabel: '1080p' },
      { quality: 'hd720', qualityLabel: '720p' },
      { quality: 'auto', qualityLabel: 'Auto' },
    ])!;
    expect(info.qualities.map((q) => q.label)).toEqual(['2160p60', '1080p', '720p']);
    expect(info.qualities[0]).toMatchObject({ quality: 'hd2160', avc: false, vp9: true, sizes: {} });
    expect(info.qualities[1]).toMatchObject({ quality: 'hd1080', avc: true });
    expect(info.embeddable).toBe(true);
    expect(info.duration).toBe(634);
  });

  it('ignores empty responses and marks live streams (recorded from the page)', () => {
    expect(describeFormats({})).toBeNull();
    const live = describeFormats(response([AAC], { videoDetails: { videoId: 'x', title: 'Direct', isLive: true } }))!;
    expect(live.live).toBe(true);
    expect(live.qualities).toEqual([]);
    expect(live.embeddable).toBe(false);
  });

  it('flags videos their owner keeps off other sites', () => {
    const info = describeFormats(response([f(137, 'video/mp4; codecs="avc1"', '1080p', 1), AAC], { playabilityStatus: { status: 'OK', playableInEmbed: false } }))!;
    expect(info.embeddable).toBe(false);
  });
});
