import { describe, expect, it } from 'vitest';
import { scrabbleApply, scrabbleInitialState, decodeScrabbleAction } from './scrabble';
import { GameStateSchema } from '../../games/scrabble/schema';
import type { GameAction } from '../protocol';

const uid = () => {
  let n = 0;
  return () => `id-${n++}`;
};

describe('decoding a well-formed action', () => {
  it.each([
    [{ type: 'addPlayers', names: 'Ada, Grace' }],
    [{ type: 'removePlayer', id: 'p1' }],
    [{ type: 'setCurrent', id: 'p1' }],
    [{ type: 'recordPlay', words: [{ word: 'QUIZ', points: 22 }], bingo: false }],
    [{ type: 'recordPlay', words: [], bingo: true }],
    [{ type: 'pass' }],
    [{ type: 'adjust', playerId: 'p1', points: -8 }],
    [{ type: 'undo' }],
    [{ type: 'newGame' }],
    [{ type: 'resetAll' }],
  ] as [GameAction][])('accepts %o', (action) => {
    expect(decodeScrabbleAction(action)).toEqual(action);
  });
});

/**
 * The protocol only checks that an action has a type. Anything malformed that
 * slipped past here would reach the reducer and throw inside the room, taking
 * the connection with it.
 */
describe('refusing a hostile payload', () => {
  it.each([
    ['names that are not a string', { type: 'addPlayers', names: ['Ada'] }],
    ['a missing id', { type: 'removePlayer' }],
    ['words that are not an array', { type: 'recordPlay', words: 'QUIZ', bingo: false }],
    ['a word with no points', { type: 'recordPlay', words: [{ word: 'QUIZ' }], bingo: false }],
    ['fractional points', { type: 'recordPlay', words: [{ word: 'A', points: 1.5 }], bingo: false }],
    ['negative points', { type: 'recordPlay', words: [{ word: 'A', points: -5 }], bingo: false }],
    ['a missing bingo flag', { type: 'recordPlay', words: [] }],
    ['a bingo that is not a boolean', { type: 'recordPlay', words: [], bingo: 'yes' }],
    ['an adjustment that is not a number', { type: 'adjust', playerId: 'p1', points: 'lots' }],
    ['an action nobody handles', { type: 'rewriteHistory' }],
  ] as [string, GameAction][])('refuses %s', (_label, action) => {
    expect(decodeScrabbleAction(action)).toBeNull();
  });

  // A play forms a handful of words at most, and a score has a ceiling.
  it('refuses absurd magnitudes', () => {
    const word = { word: 'A', points: 1 };
    expect(decodeScrabbleAction({
      type: 'recordPlay', words: Array(9).fill(word), bingo: false,
    })).toBeNull();
    expect(decodeScrabbleAction({
      type: 'recordPlay', words: [{ word: 'A', points: 99_999 }], bingo: false,
    })).toBeNull();
    expect(decodeScrabbleAction({ type: 'adjust', playerId: 'p1', points: 100_000 })).toBeNull();
  });

  it('drops fields the action does not declare', () => {
    expect(decodeScrabbleAction({ type: 'pass', sneaky: 1 })).toEqual({ type: 'pass' });
  });
});

describe('applying', () => {
  it('runs the real reducer with the room own id source', () => {
    const apply = scrabbleApply(uid());
    const state = apply(scrabbleInitialState(), { type: 'addPlayers', names: 'Ada' });
    expect(GameStateSchema.parse(state).players).toEqual([{ id: 'id-0', name: 'Ada' }]);
  });

  it('returns null rather than throwing on a bad payload', () => {
    const apply = scrabbleApply(uid());
    expect(() => apply(scrabbleInitialState(), { type: 'addPlayers', names: 7 })).not.toThrow();
    expect(apply(scrabbleInitialState(), { type: 'addPlayers', names: 7 })).toBeNull();
  });

  // The room tells a declined action apart from an applied one by identity.
  it('hands back the very same snapshot when the reducer declines', () => {
    const apply = scrabbleApply(uid());
    const start = scrabbleInitialState();
    expect(apply(start, { type: 'undo' })).toBe(start);
  });

  // Written by an older deploy, or a room somehow holding another game.
  it('refuses a snapshot that is not a Scrabble game', () => {
    const apply = scrabbleApply(uid());
    expect(apply({ players: [], rounds: [] }, { type: 'undo' })).toBeNull();
  });
});
