import { describe, expect, it } from 'vitest';
import { bestRun } from '../../src/offscreen/capture';
import type { StoredChunk } from '../../src/shared/idb';

let seq = 0;
const chunk = (bytes: number[], init = false): StoredChunk => ({
  jobId: 'j',
  track: 0,
  seq: seq++,
  init,
  data: new Uint8Array(bytes).buffer,
});
const bytes = (run: StoredChunk[]) => run.map((c) => [...new Uint8Array(c.data)]);

describe('bestRun', () => {
  it('keeps the largest run when the init segment changes (quality switch)', () => {
    const run = bestRun([chunk([1], true), chunk([2]), chunk([9], true), chunk([3]), chunk([4])]);
    expect(bytes(run)).toEqual([[9], [3], [4]]);
  });

  it('continues the run when the player re-appends the same init segment', () => {
    const run = bestRun([chunk([1, 1], true), chunk([2]), chunk([3]), chunk([1, 1], true), chunk([4])]);
    expect(bytes(run)).toEqual([[1, 1], [2], [3], [4]]);
  });

  it('falls back to the data when no init was seen', () => {
    expect(bytes(bestRun([chunk([5]), chunk([6])]))).toEqual([[5], [6]]);
    expect(bestRun([])).toEqual([]);
  });
});
