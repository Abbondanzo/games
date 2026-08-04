import { describe, expect, it } from 'vitest';
import { rummikubApply, rummikubInitialState, decodeRummikubAction } from './rummikub';
import { RummikubStateSchema } from '../../games/rummikub/schema';
import type { GameAction } from '../protocol';

const uid = () => {
  let n = 0;
  return () => `id-${n++}`;
};

describe('decoding a well-formed action', () => {
  it.each([
    [{ type: 'addPlayers', names: 'Ada, Grace' }],
    [{ type: 'removePlayer', id: 'p1' }],
    [{ type: 'movePlayer', id: 'p1', to: 0 }],
    [{ type: 'movePlayer', id: 'p1', to: 0 }],
    [{ type: 'recordRound', winnerId: 'p1', penalties: { p2: 24, p3: 41 } }],
    [{ type: 'recordRound', winnerId: 'p1', penalties: {} }],
    [{ type: 'undo' }],
    [{ type: 'newGame' }],
    [{ type: 'resetAll' }],
  ] as [GameAction][])('accepts %o', (action) => {
    expect(decodeRummikubAction(action)).toEqual(action);
  });
});

describe('refusing a hostile payload', () => {
  it.each([
    ['a missing winner', { type: 'recordRound', penalties: {} }],
    ['a seat that is not a number', { type: 'movePlayer', id: 'p1', to: 'first' }],
    ['a seat past any real roster', { type: 'movePlayer', id: 'p1', to: 1e9 }],
    ['a negative seat', { type: 'movePlayer', id: 'p1', to: -1 }],
    ['a fractional seat', { type: 'movePlayer', id: 'p1', to: 1.5 }],
    ['a move with no seat at all', { type: 'movePlayer', id: 'p1' }],
    ['penalties that are not an object', { type: 'recordRound', winnerId: 'p1', penalties: 24 }],
    ['a penalty that is not a number', { type: 'recordRound', winnerId: 'p1', penalties: { p2: 'lots' } }],
    ['a fractional penalty', { type: 'recordRound', winnerId: 'p1', penalties: { p2: 1.5 } }],
    ['a negative penalty', { type: 'recordRound', winnerId: 'p1', penalties: { p2: -5 } }],
    ['an action nobody handles', { type: 'shuffleEverything' }],
  ] as [string, GameAction][])('refuses %s', (_label, action) => {
    expect(decodeRummikubAction(action)).toBeNull();
  });

  // A rack cannot be worth more than every tile in the box.
  it('refuses a rack larger than the game contains', () => {
    expect(decodeRummikubAction({
      type: 'recordRound', winnerId: 'p1', penalties: { p2: 1_000_000 },
    })).toBeNull();
  });
});

describe('applying', () => {
  it('runs the real reducer with the room own id source', () => {
    const apply = rummikubApply(uid());
    const state = apply(rummikubInitialState(), { type: 'addPlayers', names: 'Ada' });
    expect(RummikubStateSchema.parse(state).players).toEqual([{ id: 'id-0', name: 'Ada' }]);
  });

  it('returns null rather than throwing on a bad payload', () => {
    const apply = rummikubApply(uid());
    expect(apply(rummikubInitialState(), { type: 'addPlayers', names: null })).toBeNull();
  });

  it('hands back the very same snapshot when the reducer declines', () => {
    const apply = rummikubApply(uid());
    const start = rummikubInitialState();
    expect(apply(start, { type: 'undo' })).toBe(start);
  });

  it('refuses a snapshot that is not a Rummikub game', () => {
    const apply = rummikubApply(uid());
    expect(apply({ players: [], turns: [], currentIndex: 0, variant: 'standard' }, { type: 'undo' }))
      .toBeNull();
  });
});
