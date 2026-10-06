import { keepImages, largestFromSrcset, type PageImage } from '../shared/images';

const IMAGE_LINK = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;
/** Elements looked at for a background picture (a page can have tens of thousands). */
const MAX_BACKGROUNDS = 4000;

/** The pictures of this page: <img> (their biggest version), <picture>, links to pictures, backgrounds, the page's preview. */
export function pageImages(): PageImage[] {
  const base = location.href;
  const out: PageImage[] = [];
  const abs = (u: string | null | undefined) => {
    if (!u) return undefined;
    try {
      return new URL(u, base).href;
    } catch {
      return undefined;
    }
  };
  for (const img of document.images) {
    const big = img.srcset ? largestFromSrcset(img.srcset, base) : undefined;
    const url = big ?? img.currentSrc ?? abs(img.src);
    if (url)
      out.push({
        url,
        w: big && big !== img.currentSrc ? 0 : img.naturalWidth,
        h: big && big !== img.currentSrc ? 0 : img.naturalHeight,
        ...(img.alt ? { alt: img.alt.slice(0, 200) } : {}),
      });
    // Lazy pictures keep their real address aside.
    const lazy = abs(img.dataset.src ?? img.dataset.original ?? img.dataset.lazySrc);
    if (lazy && lazy !== url) out.push({ url: lazy, w: 0, h: 0 });
  }
  for (const source of document.querySelectorAll<HTMLSourceElement>('picture source[srcset]')) {
    const url = largestFromSrcset(source.srcset, base);
    if (url) out.push({ url, w: 0, h: 0 });
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (IMAGE_LINK.test(a.pathname)) out.push({ url: a.href, w: 0, h: 0 });
  }
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"], meta[name="twitter:image"]')) {
    const url = abs(meta.content);
    if (url) out.push({ url, w: 0, h: 0 });
  }
  let looked = 0;
  for (const el of document.body?.querySelectorAll<HTMLElement>('*') ?? []) {
    if (++looked > MAX_BACKGROUNDS) break;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    for (const m of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) {
      const url = abs(m[1]);
      if (url) out.push({ url, w: 0, h: 0 });
    }
  }
  return keepImages(out);
}
