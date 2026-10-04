import { beforeAll, describe, expect, it } from 'vitest';
import type { Job } from '../../src/shared/types';

beforeAll(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    i18n: { getMessage: (k: string, subs?: string[]) => [k, ...(subs ?? [])].join('|') },
  };
});

const job = (status: Job['status'], progress = 0, title = 'Clip'): Job =>
  ({ id: Math.random().toString(36), status, progress, title, tabId: 1, mediaId: 'm', mode: 'video', bytes: 0, speed: 0, filename: '', pageUrl: '', kind: 'file', startedAt: 0 }) as Job;

describe('progressBadge', () => {
  it('shows the progress of what runs', async () => {
    const { progressBadge } = await import('../../src/background/badge');
    expect(progressBadge([job('downloading', 0.42)])).toMatchObject({ text: '42%', title: 'badgeProgress|42|Clip' });
    expect(progressBadge([job('downloading', 0.2), job('processing', 0.6)])).toMatchObject({ text: '40%', title: 'badgeProgress|40|badgeMany|2' });
  });
  it('never says 100% before the file is saved, waits with "…" while queued', async () => {
    const { progressBadge } = await import('../../src/background/badge');
    expect(progressBadge([job('saving', 1)])!.text).toBe('99%');
    expect(progressBadge([job('queued')])!.text).toBe('…');
  });
  it('is empty when nothing runs', async () => {
    const { progressBadge } = await import('../../src/background/badge');
    expect(progressBadge([job('done', 1), job('error')])).toBeNull();
  });
});
