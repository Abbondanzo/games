/**
 * Reading and writing this device's saves.
 *
 * The guard around every access is the point: `localStorage` throws rather than
 * returning null when a browser has it turned off, and nothing in an ordinary
 * test run ever throws, so the failure only shows up on somebody's phone in
 * private browsing. These make it show up here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { clampIndex, keepValid, readJson, removeKey, writeJson } from './localStore';

const Shape = z.object({ name: z.string(), score: z.int() });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('reading', () => {
  it('gives back what was written', () => {
    writeJson('k', { name: 'Ada', score: 22 });
    expect(readJson('k', Shape)).toEqual({ name: 'Ada', score: 22 });
  });

  it('is null when there is nothing there', () => {
    expect(readJson('k', Shape)).toBeNull();
  });

  it('is null rather than a throw when the value is not JSON', () => {
    localStorage.setItem('k', 'not json at all {');
    expect(readJson('k', Shape)).toBeNull();
  });

  it('is null when the value is the wrong shape', () => {
    localStorage.setItem('k', JSON.stringify({ name: 'Ada', score: 'lots' }));
    expect(readJson('k', Shape)).toBeNull();
  });

  it('drops keys the shape does not declare', () => {
    localStorage.setItem('k', JSON.stringify({ name: 'Ada', score: 22, sneaky: true }));
    expect(readJson('k', Shape)).toEqual({ name: 'Ada', score: 22 });
  });

  it('is null when storage itself refuses to be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private browsing');
    });
    expect(readJson('k', Shape)).toBeNull();
  });
});

describe('writing', () => {
  it('does not throw when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => writeJson('k', { name: 'Ada', score: 22 })).not.toThrow();
  });

  it('overwrites what was there', () => {
    writeJson('k', { name: 'Ada', score: 1 });
    writeJson('k', { name: 'Ada', score: 2 });
    expect(readJson('k', Shape)?.score).toBe(2);
  });
});

describe('removing', () => {
  it('takes the value away', () => {
    writeJson('k', { name: 'Ada', score: 22 });
    removeKey('k');
    expect(readJson('k', Shape)).toBeNull();
  });

  it('does not throw when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => removeKey('k')).not.toThrow();
  });
});

/**
 * A game is worth more than the worst row in it. One malformed turn should cost
 * that turn, not the whole save - and it must go, because a replay that looks
 * up a player who is not there would throw while rendering, which would leave
 * the bad payload stuck in storage forever.
 */
describe('keeping the entries that still make sense', () => {
  const Entry = z.object({ id: z.string(), owner: z.string() });
  const owners = new Set(['a', 'g']);
  const ownerOf = (e: { owner: string }) => e.owner;

  it('keeps entries owned by somebody on the roster', () => {
    const raw = [
      { id: '1', owner: 'a' },
      { id: '2', owner: 'g' },
    ];
    expect(keepValid(raw, Entry, ownerOf, owners)).toEqual(raw);
  });

  it('drops an entry whose owner has been removed', () => {
    const raw = [
      { id: '1', owner: 'a' },
      { id: '2', owner: 'gone' },
    ];
    expect(keepValid(raw, Entry, ownerOf, owners)).toEqual([{ id: '1', owner: 'a' }]);
  });

  it('drops one malformed entry and keeps the rest', () => {
    const raw = [{ id: '1', owner: 'a' }, { nonsense: true }, { id: '3', owner: 'g' }];
    expect(keepValid(raw, Entry, ownerOf, owners)).toHaveLength(2);
  });

  it.each([[null], [undefined], ['a string'], [42], [[]]])('shrugs at %s', (entry) => {
    expect(keepValid([entry], Entry, ownerOf, owners)).toEqual([]);
  });

  it('gives back nothing when there is nobody on the roster', () => {
    expect(keepValid([{ id: '1', owner: 'a' }], Entry, ownerOf, new Set())).toEqual([]);
  });
});

describe('a turn pointer that outlived its roster', () => {
  it.each([
    ['stays where it is inside the list', 1, 3, 1],
    ['comes back to the start when past the end', 5, 3, 0],
    ['comes back when the list emptied', 2, 0, 0],
    ['is fine at the last seat', 2, 3, 2],
  ])('%s', (_label, index, length, expected) => {
    expect(clampIndex(index, length)).toBe(expected);
  });
});
