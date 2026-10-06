import { afterEach, describe, expect, it, vi } from 'vitest';

/** The page script once Grabby is updated: `chrome.runtime.id` gone, or reading it throws. */
describe('alive / onDead (Grabby updated while a page stays open)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    delete (globalThis as { __grabby?: unknown }).__grabby;
  });

  it('is alive while the extension answers, not once its id is gone or throws', async () => {
    const runtime: { id?: string } = { id: 'jfdmeijibindbddjgibmhcklaenboehe' };
    vi.stubGlobal('chrome', { runtime });
    const { alive } = await import('../../src/content/alive');
    expect(alive()).toBe(true);
    delete runtime.id;
    expect(alive()).toBe(false);
    vi.stubGlobal('chrome', {
      get runtime(): never {
        throw new Error('Extension context invalidated.');
      },
    });
    expect(alive()).toBe(false);
  });

  it('a second copy stays out of the way of one still answering, and takes over from one cut off', async () => {
    vi.stubGlobal('chrome', { runtime: { id: 'x' } });
    const first = await import('../../src/content/alive');
    expect(first.alive()).toBe(true);
    vi.resetModules();
    const second = await import('../../src/content/alive');
    expect(second.superfluous).toBe(true);
    expect(second.alive()).toBe(false);
    expect(first.alive()).toBe(true);
    // The copy in the page lost its extension (an update): the next one runs the page.
    (globalThis as { __grabby?: () => boolean }).__grabby = () => false;
    vi.resetModules();
    const third = await import('../../src/content/alive');
    expect(third.superfluous).toBe(false);
    expect(third.alive()).toBe(true);
    expect(first.alive()).toBe(false);
  });

  it('runs its farewells once, a moment after the extension is gone', async () => {
    vi.useFakeTimers();
    const runtime: { id?: string } = { id: 'x' };
    vi.stubGlobal('chrome', { runtime });
    const { onDead } = await import('../../src/content/alive');
    const bye = vi.fn();
    const broken = vi.fn(() => {
      throw new Error('page changed');
    });
    onDead(broken);
    onDead(bye);
    vi.advanceTimersByTime(6000);
    expect(bye).not.toHaveBeenCalled();
    delete runtime.id;
    vi.advanceTimersByTime(2000);
    expect(bye).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(bye).toHaveBeenCalledTimes(1);
  });
});
