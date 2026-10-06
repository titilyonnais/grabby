import { afterEach, describe, expect, it, vi } from 'vitest';

/** The background's side of "Update", with the browser's native messaging faked. */
async function load(answer: (msg: object) => Promise<unknown>) {
  vi.resetModules();
  const reload = vi.fn();
  const sendNativeMessage = vi.fn((_host: string, msg: object) => answer(msg));
  (globalThis as { chrome?: unknown }).chrome = { runtime: { sendNativeMessage, reload } };
  const mod = await import('../../src/background/updates');
  return { ...mod, reload, sendNativeMessage };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.useRealTimers();
});

describe('installing a new version', () => {
  it('asks the helper, says it is done, then restarts Grabby', async () => {
    vi.useFakeTimers();
    const m = await load(async () => ({ ok: true, version: '1.9.1', from: '1.9.0' }));
    const seen: string[] = [];
    await m.installUpdate(false, () => seen.push(m.installState()!.step));
    expect(m.sendNativeMessage).toHaveBeenCalledWith('com.grabby.updater', { action: 'update' });
    expect(seen).toEqual(['working', 'done']);
    expect(m.installState()).toEqual({ step: 'done', version: '1.9.1' });
    expect(m.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(m.reload).toHaveBeenCalledOnce();
  });

  it('already up to date: nothing restarts', async () => {
    const m = await load(async () => ({ ok: true, upToDate: true, version: '1.9.0' }));
    await m.installUpdate(false, () => {});
    expect(m.installState()).toEqual({ step: 'uptodate', version: '1.9.0' });
    expect(m.reload).not.toHaveBeenCalled();
  });

  it('not while downloads run', async () => {
    const m = await load(async () => ({ ok: true }));
    await m.installUpdate(true, () => {});
    expect(m.installState()).toEqual({ step: 'busy' });
    expect(m.sendNativeMessage).not.toHaveBeenCalled();
  });

  it('the helper isn’t installed: says how to install it', async () => {
    const m = await load(() => Promise.reject(new Error('Specified native messaging host not found.')));
    await m.installUpdate(false, () => {});
    expect(m.installState()).toEqual({ step: 'helper_missing' });
  });

  it('the helper refused or failed: its reason', async () => {
    const m = await load(async () => ({ ok: false, error: 'bad_digest' }));
    await m.installUpdate(false, () => {});
    expect(m.installState()).toEqual({ step: 'failed', error: 'bad_digest' });
    const n = await load(() => Promise.reject(new Error('Native host has exited.')));
    await n.installUpdate(false, () => {});
    expect(n.installState()).toEqual({ step: 'failed', error: 'helper' });
  });

  it('one install at a time', async () => {
    let finish!: (v: unknown) => void;
    const m = await load(() => new Promise((ok) => (finish = ok)));
    const first = m.installUpdate(false, () => {});
    await m.installUpdate(false, () => {});
    expect(m.sendNativeMessage).toHaveBeenCalledOnce();
    finish({ ok: true, upToDate: true });
    await first;
  });
});
