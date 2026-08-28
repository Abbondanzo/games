import { describe, expect, it } from 'vitest';
import { yahtzeeApply, yahtzeeInitialState, decodeYahtzeeAction } from './yahtzee';
import { YahtzeeStateSchema } from '../../games/yahtzee/schema';
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
    [{ type: 'setCurrent', id: 'p1' }],
    [{ type: 'score', playerId: 'p1', category: 'fives', value: 15 }],
    [{ type: 'score', playerId: 'p1', category: 'yahtzee', value: 0 }],
    [{ type: 'clearBox', playerId: 'p1', category: 'chance' }],
    [{ type: 'addBonus', playerId: 'p1' }],
    [{ type: 'removeBonus', playerId: 'p1' }],
    [{ type: 'renamePlayer', id: 'p1', name: 'Ada' }],
    [{ type: 'undo' }],
    [{ type: 'newGame' }],
    [{ type: 'resetAll' }],
  ] as [GameAction][])('accepts %o', (action) => {
    expect(decodeYahtzeeAction(action)).toEqual(action);
  });
});

describe('refusing a hostile payload', () => {
  it.each([
    ['a box nobody has heard of', { type: 'score', playerId: 'p1', category: 'sevens', value: 7 }],
    ['a score with no box', { type: 'score', playerId: 'p1', value: 7 }],
    ['a score with nobody to give it to', { type: 'score', category: 'ones', value: 1 }],
    [
      'a score that is not a number',
      { type: 'score', playerId: 'p1', category: 'ones', value: 'lots' },
    ],
    ['a negative score', { type: 'score', playerId: 'p1', category: 'ones', value: -1 }],
    ['a fractional score', { type: 'score', playerId: 'p1', category: 'chance', value: 12.5 }],
    [
      'a score past anything the sheet pays',
      { type: 'score', playerId: 'p1', category: 'chance', value: 1e9 },
    ],
    ['a seat that is not a number', { type: 'movePlayer', id: 'p1', to: 'first' }],
    ['a seat past any real roster', { type: 'movePlayer', id: 'p1', to: 1e9 }],
    ['a clear with no box', { type: 'clearBox', playerId: 'p1' }],
    ['a bonus for nobody', { type: 'addBonus' }],
    ['an action nobody handles', { type: 'rollAgain' }],
  ] as [string, GameAction][])('refuses %s', (_label, action) => {
    expect(decodeYahtzeeAction(action)).toBeNull();
  });

  /**
   * The bound is per box, not per sheet: 30 is a whole large straight but no
   * count of ones, and 40 is a large straight but more than five dice can add
   * to. A single "0 to 50" check would let both through.
   */
  it.each([
    ['ones', 30],
    ['twos', 7],
    ['fives', 30],
    ['chance', 40],
    ['fullHouse', 30],
    ['smallStraight', 40],
    ['largeStraight', 30],
    ['yahtzee', 25],
  ] as [string, number][])('refuses %s holding %d', (category, value) => {
    expect(decodeYahtzeeAction({ type: 'score', playerId: 'p1', category, value })).toBeNull();
  });
});

describe('applying', () => {
  it('runs the real reducer with the room own id source', () => {
    const apply = yahtzeeApply(uid());
    const state = apply(yahtzeeInitialState(), { type: 'addPlayers', names: 'Ada' });
    expect(YahtzeeStateSchema.parse(state).players).toEqual([{ id: 'id-0', name: 'Ada' }]);
  });

  it('returns null rather than throwing on a bad payload', () => {
    const apply = yahtzeeApply(uid());
    expect(apply(yahtzeeInitialState(), { type: 'addPlayers', names: null })).toBeNull();
  });

  it('hands back the very same snapshot when the reducer declines', () => {
    const apply = yahtzeeApply(uid());
    const start = yahtzeeInitialState();
    expect(apply(start, { type: 'undo' })).toBe(start);
  });

  it('refuses a snapshot that is not a Yahtzee game', () => {
    const apply = yahtzeeApply(uid());
    expect(apply({ players: [], rounds: [] }, { type: 'undo' })).toBeNull();
  });
});
