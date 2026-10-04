import { describe, expect, it } from 'vitest';
import { replacesPage } from '../../src/background/detector';

const h = (headers: Record<string, string>) => ({
  responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
});

describe('replacesPage', () => {
  it('is true for ordinary documents and media opened in a tab', () => {
    expect(replacesPage(h({ 'Content-Type': 'text/html; charset=utf-8' }))).toBe(true);
    expect(replacesPage(h({ 'Content-Type': 'video/mp4' }))).toBe(true);
    expect(replacesPage(h({}))).toBe(true);
  });

  it('is false for downloads and prerendered pages, which leave the page in place', () => {
    expect(replacesPage(h({ 'Content-Type': 'text/html', 'Content-Disposition': 'attachment; filename="a.html"' }))).toBe(false);
    expect(replacesPage(h({ 'content-type': 'application/zip' }))).toBe(false);
    expect(replacesPage(h({ 'content-type': 'application/octet-stream' }))).toBe(false);
    expect(replacesPage({ ...h({ 'content-type': 'text/html' }), documentLifecycle: 'prerender' })).toBe(false);
  });
});
