/**
 * All <video> elements of a document, including those inside open shadow roots, in a
 * stable document order. The MAIN-world hook and the isolated scanner both use this so
 * a `videoIndex` means the same element on both sides.
 */
export function deepVideos(root: Document | ShadowRoot = document): HTMLVideoElement[] {
  const out: HTMLVideoElement[] = [];
  const visit = (node: Document | ShadowRoot | Element) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    let el = walker.currentNode as Element | null;
    while (el) {
      if (el instanceof HTMLVideoElement) out.push(el);
      const shadow = (el as Element).shadowRoot;
      if (shadow) visit(shadow);
      el = walker.nextNode() as Element | null;
    }
  };
  visit(root);
  return out;
}

/** True when an append looks like an initialization segment (fMP4 ftyp/moov or WebM EBML header). */
export function isInitSegment(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return true;
  const type = String.fromCharCode(data[4]!, data[5]!, data[6]!, data[7]!);
  return type === 'ftyp' || type === 'moov';
}
