import { describe, expect, it } from 'vitest';
import { initialState, reducer, type Action } from './useGame';
import type { GameState } from '@shared/games/scrabble/types';

const run = (state: GameState, ...actions: Action[]): GameState =>
  actions.reduce(reducer, state);

const withPlayers = (): GameState =>
  run(initialState, { type: 'addPlayers', names: 'Ada, Grace, Alan' });

const play = (points: number): Action => ({
  type: 'recordPlay', words: [{ word: 'WORD', points }], bingo: false,
});

const names = (s: GameState) => s.players.map((p) => p.name);
const current = (s: GameState) => s.players[s.currentIndex]?.name;

describe('players', () => {
  it('splits a comma-separated paste into separate players', () => {
    expect(names(withPlayers())).toEqual(['Ada', 'Grace', 'Alan']);
  });

  it('ignores empty input', () => {
    expect(run(initialState, { type: 'addPlayers', names: '  ,  ' }).players).toHaveLength(0);
  });

  it('drops a removed player and their turns', () => {
    const state = run(withPlayers(), play(20));
    const adaId = state.players[0]!.id;
    const after = run(state, { type: 'removePlayer', id: adaId });
    expect(names(after)).toEqual(['Grace', 'Alan']);
    expect(after.turns).toHaveLength(0);
  });
});

describe('removing a player keeps the right person up', () => {
  const upNow = (s: GameState) => s.players[s.currentIndex]?.name;

  it('does not shift the turn onto someone else', () => {
    // Ada and Grace have played, so Alan is up.
    const state = run(withPlayers(), play(10), play(10));
    expect(upNow(state)).toBe('Alan');

    const after = run(state, { type: 'removePlayer', id: state.players[0]!.id });
    expect(upNow(after)).toBe('Alan');
  });

  it('passes the turn on when the player who was up leaves', () => {
    const state = run(withPlayers(), play(10)); // Grace is up
    const after = run(state, { type: 'removePlayer', id: state.players[1]!.id });
    expect(upNow(after)).toBe('Alan');
  });

  it('wraps when the last player in the order leaves while up', () => {
    const state = run(withPlayers(), play(10), play(10)); // Alan is up
    const after = run(state, { type: 'removePlayer', id: state.players[2]!.id });
    expect(upNow(after)).toBe('Ada');
  });

  it('ignores an unknown id', () => {
    const state = withPlayers();
    expect(run(state, { type: 'removePlayer', id: 'nope' })).toBe(state);
  });
});

describe('turn order', () => {
  it('advances after a scored turn', () => {
    const state = run(withPlayers(), play(20));
    expect(current(state)).toBe('Grace');
  });

  it('advances after a pass and records no points', () => {
    const state = run(withPlayers(), { type: 'pass' });
    expect(current(state)).toBe('Grace');
    expect(state.turns[0]).toMatchObject({ kind: 'pass', points: 0 });
  });

  it('wraps around the player list', () => {
    const state = run(withPlayers(), play(1), play(1), play(1));
    expect(current(state)).toBe('Ada');
  });

  it('can be handed to another player mid-game', () => {
    const state = withPlayers();
    const alanId = state.players[2]!.id;
    expect(current(run(state, { type: 'setCurrent', id: alanId }))).toBe('Alan');
  });
});

describe('scoring a play', () => {
  it('sums banked words and adds the bingo bonus', () => {
    const state = run(withPlayers(), {
      type: 'recordPlay',
      words: [{ word: 'QUIZ', points: 22 }, { word: 'CAT', points: 5 }],
      bingo: true,
    });
    expect(state.turns[0]).toMatchObject({ points: 77, words: ['QUIZ', 'CAT'], bingo: true });
  });

  it('records nothing when there is no word and no bingo', () => {
    const state = run(withPlayers(), { type: 'recordPlay', words: [], bingo: false });
    expect(state.turns).toHaveLength(0);
    expect(current(state)).toBe('Ada');
  });

  // A bingo is a property of a play, not a turn in its own right.
  it('rejects a bingo with no word', () => {
    const state = run(withPlayers(), { type: 'recordPlay', words: [], bingo: true });
    expect(state.turns).toHaveLength(0);
    expect(current(state)).toBe('Ada');
  });
});

describe('adjustments', () => {
  it('applies points without consuming a turn', () => {
    const state = withPlayers();
    const graceId = state.players[1]!.id;
    const after = run(state, { type: 'adjust', playerId: graceId, points: -8 });
    expect(after.turns[0]).toMatchObject({ kind: 'adjust', points: -8 });
    expect(current(after)).toBe('Ada');
  });

  it('ignores a zero adjustment', () => {
    const state = withPlayers();
    const after = run(state, { type: 'adjust', playerId: state.players[0]!.id, points: 0 });
    expect(after.turns).toHaveLength(0);
  });
});

describe('undo', () => {
  it('removes the last play and steps the turn back', () => {
    const state = run(withPlayers(), play(20), { type: 'undo' });
    expect(state.turns).toHaveLength(0);
    expect(current(state)).toBe('Ada');
  });

  it('does not step the turn back for an adjustment', () => {
    const start = run(withPlayers(), play(20));
    const after = run(start,
      { type: 'adjust', playerId: start.players[0]!.id, points: -5 },
      { type: 'undo' });
    expect(after.turns).toHaveLength(1);
    expect(current(after)).toBe('Grace');
  });

  it('is a no-op with no history', () => {
    expect(run(withPlayers(), { type: 'undo' }).turns).toHaveLength(0);
  });

  // Stepping the seat back by one lands on the wrong player if the order was
  // changed after the turn was recorded.
  it('hands the turn back to whoever played it', () => {
    const start = run(withPlayers(), play(20)); // Ada played, Grace is up
    const after = run(start,
      { type: 'setCurrent', id: start.players[0]!.id }, // hand it back to Ada
      { type: 'undo' });
    expect(current(after)).toBe('Ada');
  });
});

describe('new game', () => {
  it('clears turns and keeps players', () => {
    const state = run(withPlayers(), play(20), play(30), { type: 'newGame' });
    expect(state.turns).toHaveLength(0);
    expect(names(state)).toEqual(['Ada', 'Grace', 'Alan']);
    expect(current(state)).toBe('Ada');
  });
});

describe('reset all', () => {
  it('clears turns and players alike', () => {
    const state = run(withPlayers(), play(20), play(30), { type: 'resetAll' });
    expect(state.turns).toHaveLength(0);
    expect(state.players).toHaveLength(0);
    expect(state.currentIndex).toBe(0);
  });

  it('leaves a fresh game usable', () => {
    const state = run(withPlayers(), play(20), { type: 'resetAll' },
      { type: 'addPlayers', names: 'Kay' }, play(12));
    expect(names(state)).toEqual(['Kay']);
    expect(state.turns).toHaveLength(1);
  });
});
