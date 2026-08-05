/**
 * The roster rules every game shares.
 *
 * These were three copies before, and the copies agreed. What they were not was
 * tested directly - each game tested them through its own reducer, so the awkward
 * cases were covered once or twice rather than three times.
 */
import { describe, expect, it } from 'vitest';
import { advance, indexAfterRemoval, movedTo, parseNames, renamedTo } from './players';

describe('reading a list of names', () => {
  it.each([
    ['one name', 'Ada', ['Ada']],
    ['a pasted list', 'Ada, Grace, Alan', ['Ada', 'Grace', 'Alan']],
    ['ragged spacing', '  Ada ,Grace  ,  Alan ', ['Ada', 'Grace', 'Alan']],
    ['trailing separators', 'Ada,,Grace,', ['Ada', 'Grace']],
    ['nothing at all', '', []],
    ['only separators', ',,,', []],
    ['only spaces', '   ', []],
  ])('reads %s', (_label, raw, expected) => {
    expect(parseNames(raw)).toEqual(expected);
  });
});

describe('renaming', () => {
  const players = [
    { id: 'a', name: 'Ada' },
    { id: 'g', name: 'Grace' },
  ];

  it('changes the one named and nobody else', () => {
    expect(renamedTo(players, 'a', 'Ada L')).toEqual([
      { id: 'a', name: 'Ada L' },
      { id: 'g', name: 'Grace' },
    ]);
  });

  it('trims what it is given', () => {
    expect(renamedTo(players, 'a', '  Ada L  ')?.[0]?.name).toBe('Ada L');
  });

  /**
   * Null, not the list back. A reducer signals a no-op by handing its own state
   * back untouched, and the room reads that identity to decide whether to bump
   * its revision. Returning a fresh array would tell everyone about nothing.
   */
  it.each([
    ['an empty name', ''],
    ['only spaces', '   '],
  ])('declines %s rather than making a new list', (_label, name) => {
    expect(renamedTo(players, 'a', name)).toBeNull();
  });

  it('is content to match nobody', () => {
    expect(renamedTo(players, 'nobody', 'Ada L')).toEqual(players);
  });

  it('leaves the list it was given alone', () => {
    renamedTo(players, 'a', 'Ada L');
    expect(players[0]?.name).toBe('Ada');
  });
});

describe('moving a player in the order', () => {
  const roster = (...ids: string[]) => ids.map((id) => ({ id }));
  const ids = (players: { id: string }[] | null) => players?.map((p) => p.id);

  it('moves one earlier', () => {
    expect(ids(movedTo(roster('a', 'b', 'c'), 'c', 1))).toEqual(['a', 'c', 'b']);
  });

  it('moves one later', () => {
    expect(ids(movedTo(roster('a', 'b', 'c'), 'a', 2))).toEqual(['b', 'c', 'a']);
  });

  it('moves one to the front', () => {
    expect(ids(movedTo(roster('a', 'b', 'c'), 'c', 0))).toEqual(['c', 'a', 'b']);
  });

  it('takes everyone else along in order', () => {
    expect(ids(movedTo(roster('a', 'b', 'c', 'd'), 'b', 3))).toEqual(['a', 'c', 'd', 'b']);
  });

  it.each([
    ['past the end', 9, ['b', 'c', 'a']],
    ['before the start', -4, ['a', 'b', 'c']],
  ])('goes as far as there is when asked to go %s', (_label, to, expected) => {
    const moved = movedTo(roster('a', 'b', 'c'), 'a', to);
    // Landing back where it started is a no-op, hence the null for -4.
    expect(moved === null ? ['a', 'b', 'c'] : ids(moved)).toEqual(expected);
  });

  // Null, not the list back, for the reason renamedTo gives.
  it('declines a move to the place it is already in', () => {
    expect(movedTo(roster('a', 'b', 'c'), 'b', 1)).toBeNull();
  });

  it('declines a player who is not there', () => {
    expect(movedTo(roster('a', 'b'), 'nobody', 0)).toBeNull();
  });

  it('leaves the list it was given alone', () => {
    const before = roster('a', 'b', 'c');
    movedTo(before, 'a', 2);
    expect(ids(before)).toEqual(['a', 'b', 'c']);
  });
});

describe('moving to the next player', () => {
  it.each([
    ['wraps at the end', 2, 3, 0],
    ['steps along', 0, 3, 1],
    ['stays put with one player', 0, 1, 0],
    ['is zero with nobody at all', 0, 0, 0],
    ['comes back inside a list that shrank', 9, 3, 1],
  ])('%s', (_label, index, count, expected) => {
    expect(advance(index, count)).toBe(expected);
  });
});

/**
 * The fiddly one. It was written twice, identically, and the awkward case is
 * the player who was up being the one to leave.
 */
describe('where the turn goes when somebody leaves', () => {
  const roster = (...ids: string[]) => ids.map((id) => ({ id }));

  it('keeps the same player up, not the same seat', () => {
    // Grace is up at index 1; removing Ada shifts her to 0.
    expect(indexAfterRemoval(roster('a', 'g', 'l'), 1, 'a')).toBe(0);
  });

  it('leaves the pointer alone when someone later leaves', () => {
    expect(indexAfterRemoval(roster('a', 'g', 'l'), 0, 'l')).toBe(0);
  });

  it('hands the turn on when the player who was up leaves', () => {
    // Grace at index 1 goes, so Alan takes over - who is at index 1 afterwards.
    expect(indexAfterRemoval(roster('a', 'g', 'l'), 1, 'g')).toBe(1);
  });

  it('wraps when the last player was up and leaves', () => {
    expect(indexAfterRemoval(roster('a', 'g', 'l'), 2, 'l')).toBe(0);
  });

  it('is zero when the last player of all leaves', () => {
    expect(indexAfterRemoval(roster('a'), 0, 'a')).toBe(0);
  });

  it('is zero when there was nobody to begin with', () => {
    expect(indexAfterRemoval([], 0, 'a')).toBe(0);
  });

  it('never points past the end', () => {
    const before = roster('a', 'g', 'l');
    for (let i = 0; i < before.length; i += 1) {
      for (const id of ['a', 'g', 'l']) {
        expect(indexAfterRemoval(before, i, id)).toBeLessThan(before.length - 1);
      }
    }
  });

  it('shrugs at a player who was never there', () => {
    // findIndex gives -1, and -1 % 3 is -0 in JavaScript, which is not an index.
    expect(indexAfterRemoval(roster('a', 'g', 'l'), 1, 'nobody')).toBe(1);
  });
});
