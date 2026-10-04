import type { SegRef } from '../shared/plan';
import { resolveUrl } from './url';

export interface HlsVariant {
  url: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  audio?: string;
}

export interface HlsAudio {
  groupId: string;
  name: string;
  lang?: string;
  url?: string;
  isDefault: boolean;
}

export interface HlsMaster {
  type: 'master';
  variants: HlsVariant[];
  audio: HlsAudio[];
  encrypted: boolean;
}

export interface HlsSegment extends SegRef {
  duration: number;
}

export interface HlsMedia {
  type: 'media';
  segments: HlsSegment[];
  map?: SegRef;
  duration: number;
  endList: boolean;
  encrypted: boolean;
}

/** Parses an HLS attribute list: KEY=value,KEY="quoted, value". */
export function parseAttributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let v = m[2]!;
    if (v.startsWith('"')) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

/** "length[@offset]" → inclusive range, using `next` as the implicit offset. */
function byterange(spec: string, next: number): [number, number] {
  const [len, off] = spec.split('@');
  const start = off !== undefined ? Number(off) : next;
  return [start, start + Number(len) - 1];
}

function isEncrypting(attrs: Record<string, string>): boolean {
  return (attrs.METHOD ?? 'NONE').toUpperCase() !== 'NONE';
}

export function parseHls(text: string, baseUrl: string): HlsMaster | HlsMedia {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('Not an HLS playlist');

  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  let encrypted = false;

  if (isMaster) {
    const variants: HlsVariant[] = [];
    const audio: HlsAudio[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const a = parseAttributes(line.slice(18));
        let uri = lines[i + 1];
        while (uri !== undefined && uri.startsWith('#')) uri = lines[++i + 1];
        if (uri === undefined) break;
        i++;
        const [w, h] = (a.RESOLUTION ?? '').split('x').map(Number);
        variants.push({
          url: resolveUrl(uri, baseUrl),
          // The average bitrate when told: BANDWIDTH is the peak, and sizes estimated from it
          // come out far too big (an 1.1 GB episode announced at 1.8 GB).
          bandwidth: Number(a['AVERAGE-BANDWIDTH'] ?? a.BANDWIDTH ?? 0),
          ...(w && h ? { width: w, height: h } : {}),
          ...(a.CODECS ? { codecs: a.CODECS } : {}),
          ...(a.AUDIO ? { audio: a.AUDIO } : {}),
        });
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        const a = parseAttributes(line.slice(13));
        if (a.TYPE !== 'AUDIO') continue;
        audio.push({
          groupId: a['GROUP-ID'] ?? '',
          name: a.NAME ?? a.LANGUAGE ?? 'Audio',
          ...(a.LANGUAGE ? { lang: a.LANGUAGE } : {}),
          ...(a.URI ? { url: resolveUrl(a.URI, baseUrl) } : {}),
          isDefault: a.DEFAULT === 'YES',
        });
      } else if (line.startsWith('#EXT-X-SESSION-KEY:')) {
        if (isEncrypting(parseAttributes(line.slice(19)))) encrypted = true;
      }
    }
    return { type: 'master', variants, audio, encrypted };
  }

  const segments: HlsSegment[] = [];
  let map: SegRef | undefined;
  let duration = 0;
  let pendingDuration = 0;
  let pendingRange: string | undefined;
  let nextOffset = 0;
  let endList = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = parseFloat(line.slice(8)) || 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice(17);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      if (isEncrypting(parseAttributes(line.slice(11)))) encrypted = true;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributes(line.slice(11));
      if (a.URI) {
        map = { url: resolveUrl(a.URI, baseUrl) };
        if (a.BYTERANGE) map.range = byterange(a.BYTERANGE, 0);
      }
    } else if (line === '#EXT-X-ENDLIST') {
      endList = true;
    } else if (!line.startsWith('#')) {
      const seg: HlsSegment = { url: resolveUrl(line, baseUrl), duration: pendingDuration };
      if (pendingRange) {
        seg.range = byterange(pendingRange, nextOffset);
        nextOffset = seg.range[1] + 1;
      }
      segments.push(seg);
      duration += pendingDuration;
      pendingDuration = 0;
      pendingRange = undefined;
    }
  }
  return { type: 'media', segments, ...(map ? { map } : {}), duration, endList, encrypted };
}
