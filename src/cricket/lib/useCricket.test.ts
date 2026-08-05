import { describe, expect, it } from 'vitest';
import { initialState, reducer, type Action } from './useCricket';
import type { CricketState, Dart } from '@shared/games/cricket/types';

const run = (state: CricketState, ...actions: Action[]): CricketState =>
  actions.reduce(reducer, state);

const withPlayers = (): CricketState =>
  run(initialState, { type: 'addPlayers', names: 'Ada, Grace, Alan' });

const dart: Dart = { target: 20, multiplier: 3 };
const throwTurn: Action = { type: 'recordTurn', darts: [dart, dart, dart] };

const current = (s: CricketState) => s.players[s.currentIndex]?.name;

describe('players', () => {
  it('adds a comma-separated list', () => {
    expect(withPlayers().players.map((p) => p.name)).toEqual(['Ada', 'Grace', 'Alan']);
  });

  it('removes a player along with their turns', () => {
    const state = run(withPlayers(), throwTurn);
    const after = run(state, { type: 'removePlayer', id: state.players[0]!.id });
    expect(after.players).toHaveLength(2);
    expect(after.turns).toHaveLength(0);
  });
});

describe('removing a player keeps the right person up', () => {
  const upNow = (s: CricketState) => s.players[s.currentIndex]?.name;

  it('does not shift the turn onto someone else', () => {
    const state = run(withPlayers(), throwTurn, throwTurn); // Alan is up
    const after = run(state, { type: 'removePlayer', id: state.players[0]!.id });
    expect(upNow(after)).toBe('Alan');
  });

  it('passes the turn on when the player who was up leaves', () => {
    const state = run(withPlayers(), throwTurn); // Grace is up
    const after = run(state, { type: 'removePlayer', id: state.players[1]!.id });
    expect(upNow(after)).toBe('Alan');
  });

  it('wraps when the last player in the order leaves while up', () => {
    const state = run(withPlayers(), throwTurn, throwTurn); // Alan is up
    const after = run(state, { type: 'removePlayer', id: state.players[2]!.id });
    expect(upNow(after)).toBe('Ada');
  });
});

describe('joining', () => {
  it('stamps the join point with the turns played so far', () => {
    const state = run(withPlayers(), throwTurn, throwTurn, { type: 'addPlayers', names: 'Kay' });
    expect(state.players.map((p) => p.joinedAtTurn)).toEqual([0, 0, 0, 2]);
  });
});

describe('turn order', () => {
  it('advances after a recorded turn and wraps around', () => {
    expect(current(run(withPlayers(), throwTurn))).toBe('Grace');
    expect(current(run(withPlayers(), throwTurn, throwTurn, throwTurn))).toBe('Ada');
  });

  it('records nothing for an empty throw', () => {
    const state = run(withPlayers(), { type: 'recordTurn', darts: [] });
    expect(state.turns).toHaveLength(0);
    expect(current(state)).toBe('Ada');
  });

  it('can be handed to another player', () => {
    const state = withPlayers();
    expect(current(run(state, { type: 'setCurrent', id: state.players[2]!.id }))).toBe('Alan');
  });
});

describe('undo', () => {
  it('drops the last turn and steps the order back', () => {
    const state = run(withPlayers(), throwTurn, { type: 'undo' });
    expect(state.turns).toHaveLength(0);
    expect(current(state)).toBe('Ada');
  });

  it('is a no-op with no history', () => {
    expect(run(withPlayers(), { type: 'undo' }).turns).toHaveLength(0);
  });

  it('hands the turn back to whoever threw it', () => {
    const start = run(withPlayers(), throwTurn); // Ada threw, Grace is up
    const after = run(start, { type: 'setCurrent', id: start.players[0]!.id }, { type: 'undo' });
    expect(current(after)).toBe('Ada');
  });
});

describe('variant', () => {
  // Only darts are stored, so a mode change rescores rather than restarts.
  it('keeps every throw when the mode changes', () => {
    const state = run(withPlayers(), throwTurn, throwTurn, {
      type: 'setVariant',
      variant: 'cutthroat',
    });
    expect(state.variant).toBe('cutthroat');
    expect(state.turns).toHaveLength(2);
    expect(state.players).toHaveLength(3);
  });

  it('leaves the turn order untouched', () => {
    const state = run(withPlayers(), throwTurn, { type: 'setVariant', variant: 'nopoints' });
    expect(current(state)).toBe('Grace');
  });

  it('survives a round trip through every mode', () => {
    const state = run(
      withPlayers(),
      throwTurn,
      { type: 'setVariant', variant: 'cutthroat' },
      { type: 'setVariant', variant: 'nopoints' },
      { type: 'setVariant', variant: 'standard' },
    );
    expect(state.variant).toBe('standard');
    expect(state.turns).toHaveLength(1);
  });

  it('does nothing when the mode is unchanged', () => {
    const before = run(withPlayers(), throwTurn);
    expect(reducer(before, { type: 'setVariant', variant: 'standard' })).toBe(before);
  });
});

describe('reset all', () => {
  it('clears throws and players alike', () => {
    const state = run(withPlayers(), throwTurn, throwTurn, { type: 'resetAll' });
    expect(state.turns).toHaveLength(0);
    expect(state.players).toHaveLength(0);
    expect(state.currentIndex).toBe(0);
  });

  // The mode is a preference rather than game data.
  it('keeps the chosen mode', () => {
    const state = run(
      withPlayers(),
      throwTurn,
      { type: 'setVariant', variant: 'cutthroat' },
      { type: 'resetAll' },
    );
    expect(state.variant).toBe('cutthroat');
  });
});

describe('new game', () => {
  it('clears the board and keeps the players', () => {
    const state = run(withPlayers(), throwTurn, throwTurn, { type: 'newGame' });
    expect(state.turns).toHaveLength(0);
    expect(state.players).toHaveLength(3);
    expect(current(state)).toBe('Ada');
  });
});
