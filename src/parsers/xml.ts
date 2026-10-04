/** Minimal, dependency-free XML parser (service workers have no DOMParser). */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const localName = (n: string): string => n.slice(n.indexOf(':') + 1);

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1]!;
    if (lt === -1) {
      top.text += decode(src.slice(i));
      break;
    }
    if (lt > i) top.text += decode(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      top.text += src.slice(lt + 9, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 3;
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      if (stack.length > 1) stack.pop();
      i = end === -1 ? src.length : end + 1;
    } else {
      // find tag end, honoring quotes
      let j = lt + 1;
      let quote = '';
      while (j < src.length) {
        const c = src[j]!;
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      const raw = src.slice(lt + 1, j);
      const selfClosing = raw.endsWith('/');
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const nameMatch = /^[^\s/>]+/.exec(body);
      const node: XmlNode = { name: localName(nameMatch ? nameMatch[0] : ''), attrs: {}, children: [], text: '' };
      attrRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      const attrPart = body.slice(nameMatch ? nameMatch[0].length : 0);
      while ((m = attrRe.exec(attrPart))) {
        node.attrs[localName(m[1]!)] = decode(m[3] ?? m[4] ?? '');
      }
      top.children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  const first = root.children[0];
  if (!first) throw new Error('Empty XML document');
  return trimText(first);
}

function trimText(n: XmlNode): XmlNode {
  n.text = n.text.trim();
  n.children.forEach(trimText);
  return n;
}

export const children = (n: XmlNode, name: string): XmlNode[] => n.children.filter((c) => c.name === name);
export const child = (n: XmlNode, name: string): XmlNode | undefined => n.children.find((c) => c.name === name);

/** Depth-first search for any descendant named `name`. */
export function hasDescendant(n: XmlNode, name: string): boolean {
  return n.children.some((c) => c.name === name || hasDescendant(c, name));
}
