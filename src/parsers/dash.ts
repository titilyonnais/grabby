import type { SegRef } from '../shared/plan';
import { parseRange, resolveUrl } from './url';
import { child, children, hasDescendant, parseXml, type XmlNode } from './xml';

export interface DashRep {
  id: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  mimeType: string;
  lang?: string;
  init?: SegRef;
  segments: SegRef[];
}

export interface DashManifest {
  dynamic: boolean;
  duration: number;
  protected: boolean;
  video: DashRep[];
  audio: DashRep[];
}

/** ISO-8601 duration (PnDTnHnMnS) → seconds. */
export function parseIsoDuration(s: string | undefined): number {
  if (!s) return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return 0;
  const [, d, h, min, sec] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(sec ?? 0);
}

interface TemplateInfo {
  attrs: Record<string, string>;
  timeline?: XmlNode;
}

function mergeTemplate(parent: TemplateInfo | undefined, node: XmlNode | undefined): TemplateInfo | undefined {
  if (!node) return parent;
  return {
    attrs: { ...(parent?.attrs ?? {}), ...node.attrs },
    timeline: child(node, 'SegmentTimeline') ?? parent?.timeline,
  };
}

function fillTemplate(tpl: string, vars: { id: string; bandwidth: number; number?: number; time?: number }): string {
  return tpl.replace(/\$(RepresentationID|Number|Time|Bandwidth|)(%0(\d+)d)?\$/g, (_m, name: string, _f, width?: string) => {
    let v: string;
    switch (name) {
      case '':
        return '$';
      case 'RepresentationID':
        return vars.id;
      case 'Number':
        v = String(vars.number ?? 0);
        break;
      case 'Time':
        v = String(vars.time ?? 0);
        break;
      default:
        v = String(vars.bandwidth);
    }
    return width ? v.padStart(Number(width), '0') : v;
  });
}

function templateSegments(
  t: TemplateInfo,
  base: string,
  vars: { id: string; bandwidth: number },
  periodDuration: number,
): { init?: SegRef; segments: SegRef[] } {
  const a = t.attrs;
  const timescale = Number(a.timescale ?? 1) || 1;
  const startNumber = Number(a.startNumber ?? 1);
  const init = a.initialization ? { url: resolveUrl(fillTemplate(a.initialization, vars), base) } : undefined;
  const media = a.media;
  const segments: SegRef[] = [];
  if (!media) return { ...(init ? { init } : {}), segments };

  if (t.timeline) {
    let time = 0;
    let number = startNumber;
    const end = periodDuration * timescale;
    for (const s of children(t.timeline, 'S')) {
      if (s.attrs.t !== undefined) time = Number(s.attrs.t);
      const d = Number(s.attrs.d ?? 0);
      if (!d) continue;
      let r = Number(s.attrs.r ?? 0);
      if (r < 0) r = end > 0 ? Math.max(0, Math.ceil((end - time) / d) - 1) : 0;
      for (let k = 0; k <= r; k++) {
        segments.push({ url: resolveUrl(fillTemplate(media, { ...vars, number, time }), base) });
        time += d;
        number++;
      }
    }
  } else {
    const segDur = Number(a.duration ?? 0) / timescale;
    const count = segDur > 0 && periodDuration > 0 ? Math.ceil(periodDuration / segDur - 1e-9) : 0;
    for (let k = 0; k < count; k++) {
      const number = startNumber + k;
      segments.push({ url: resolveUrl(fillTemplate(media, { ...vars, number, time: Math.round(k * segDur * timescale) }), base) });
    }
  }
  return { ...(init ? { init } : {}), segments };
}

function listSegments(list: XmlNode, base: string): { init?: SegRef; segments: SegRef[] } {
  const initNode = child(list, 'Initialization');
  let init: SegRef | undefined;
  if (initNode) {
    init = { url: resolveUrl(initNode.attrs.sourceURL ?? '', base) };
    const r = parseRange(initNode.attrs.range);
    if (r) init.range = r;
  }
  const segments = children(list, 'SegmentURL').map((s) => {
    const seg: SegRef = { url: resolveUrl(s.attrs.media ?? '', base) };
    const r = parseRange(s.attrs.mediaRange);
    if (r) seg.range = r;
    return seg;
  });
  return { ...(init ? { init } : {}), segments };
}

const VIDEO_CODEC = /^(avc|hev|hvc|vp0?[89]|av01|dvh|mp4v)/i;
const AUDIO_CODEC = /^(mp4a|opus|ac-3|ec-3|vorbis|flac|mp3|dtsc)/i;

function kindOf(contentType: string, mime: string, codecs: string): 'video' | 'audio' | null {
  if (contentType === 'video' || mime.startsWith('video/')) return 'video';
  if (contentType === 'audio' || mime.startsWith('audio/')) return 'audio';
  if (VIDEO_CODEC.test(codecs)) return 'video';
  if (AUDIO_CODEC.test(codecs)) return 'audio';
  return null;
}

function withBase(node: XmlNode, base: string): string {
  const b = child(node, 'BaseURL');
  return b && b.text ? resolveUrl(b.text, base) : base;
}

export function parseDash(text: string, baseUrl: string): DashManifest {
  const mpd = parseXml(text.replace(/^﻿/, ''));
  if (mpd.name !== 'MPD') throw new Error('Not a DASH manifest');

  const result: DashManifest = {
    dynamic: mpd.attrs.type === 'dynamic',
    duration: parseIsoDuration(mpd.attrs.mediaPresentationDuration),
    protected: hasDescendant(mpd, 'ContentProtection'),
    video: [],
    audio: [],
  };

  const period = child(mpd, 'Period');
  if (!period) return result;
  const periodDuration = parseIsoDuration(period.attrs.duration) || result.duration;
  if (!result.duration) result.duration = periodDuration;

  const mpdBase = withBase(mpd, baseUrl);
  const periodBase = withBase(period, mpdBase);
  const periodTemplate = mergeTemplate(undefined, child(period, 'SegmentTemplate'));

  for (const set of children(period, 'AdaptationSet')) {
    const setBase = withBase(set, periodBase);
    const setTemplate = mergeTemplate(periodTemplate, child(set, 'SegmentTemplate'));
    const setList = child(set, 'SegmentList');

    for (const rep of children(set, 'Representation')) {
      const mime = rep.attrs.mimeType ?? set.attrs.mimeType ?? '';
      const codecs = rep.attrs.codecs ?? set.attrs.codecs ?? '';
      const kind = kindOf(set.attrs.contentType ?? '', mime, codecs);
      if (!kind) continue;

      const repBase = withBase(rep, setBase);
      const id = rep.attrs.id ?? String(result.video.length + result.audio.length);
      const bandwidth = Number(rep.attrs.bandwidth ?? 0);
      const template = mergeTemplate(setTemplate, child(rep, 'SegmentTemplate'));
      const list = child(rep, 'SegmentList') ?? setList;

      let segs: { init?: SegRef; segments: SegRef[] };
      if (template && template.attrs.media) {
        segs = templateSegments(template, repBase, { id, bandwidth }, periodDuration);
      } else if (list) {
        segs = listSegments(list, repBase);
      } else {
        segs = { segments: [{ url: repBase }] };
      }

      const width = Number(rep.attrs.width ?? set.attrs.width ?? 0);
      const height = Number(rep.attrs.height ?? set.attrs.height ?? 0);
      const lang = set.attrs.lang ?? rep.attrs.lang;
      const out: DashRep = {
        id,
        bandwidth,
        mimeType: mime || (kind === 'video' ? 'video/mp4' : 'audio/mp4'),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(codecs ? { codecs } : {}),
        ...(lang ? { lang } : {}),
        ...segs,
      };
      (kind === 'video' ? result.video : result.audio).push(out);
    }
  }
  return result;
}
