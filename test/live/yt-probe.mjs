// Inspects what the YouTube player exposes (qualities, formats) on a watch page.
import { declineConsent, launch } from './live.mjs';

const url = process.argv[2] ?? 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
const { ctx, close } = await launch();
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await declineConsent(page);
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const p = document.getElementById('movie_player');
  const r = p?.getPlayerResponse?.();
  return {
    levels: p?.getAvailableQualityLevels?.(),
    data: p?.getAvailableQualityData?.()?.map((q) => [q.quality, q.qualityLabel, q.isPlayable]),
    current: p?.getPlaybackQuality?.(),
    hasRange: typeof p?.setPlaybackQualityRange,
    length: r?.videoDetails?.lengthSeconds,
    title: r?.videoDetails?.title,
    playable: r?.playabilityStatus?.status,
    embeddable: r?.playabilityStatus?.playableInEmbed,
    formats: r?.streamingData?.adaptiveFormats?.map((f) => `${f.itag} ${f.mimeType} ${f.qualityLabel ?? ''} ${f.contentLength ?? ''} url:${!!f.url}`),
    sabr: !!r?.streamingData?.serverAbrStreamingUrl,
    mse: [...document.querySelectorAll('video')].map((v) => v.src.slice(0, 40)),
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '.debug/yt.png' });
await close();
