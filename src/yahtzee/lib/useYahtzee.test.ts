import { beforeEach, describe, expect, it } from 'vitest';
import { initialState, reducer, readStored, STORE_KEY, type Action } from './useYahtzee';
import { YAHTZEE_SCORE } from '@shared/games/yahtzee/rules';
import type { YahtzeeState } from '@shared/games/yahtzee/types';

const run = (state: YahtzeeState, ...actions: Action[]): YahtzeeState =>
  actions.reduce(reducer, state);

const withPlayers = (): YahtzeeState =>
  run(initialState, { type: 'addPlayers', names: 'Ada, Grace, Alan' });

const id = (state: YahtzeeState, name: string) => state.players.find((p) => p.name === name)!.id;

const up = (state: YahtzeeState) => state.players[state.currentIndex]?.name;

describe('players', () => {
  it('adds a comma-separated list', () => {
    expect(withPlayers().players.map((p) => p.name)).toEqual(['Ada', 'Grace', 'Alan']);
  });

  it('starts a latecomer on an empty sheet without rescoring anyone', () => {
    const start = withPlayers();
    const played = run(start, {
      type: 'score',
      playerId: id(start, 'Ada'),
      category: 'sixes',
      value: 24,
    });
    const after = run(played, { type: 'addPlayers', names: 'Kay' });
    expect(after.turns).toHaveLength(1);
    expect(after.players.map((p) => p.name)).toEqual(['Ada', 'Grace', 'Alan', 'Kay']);
  });

  it('takes a leaving player, their sheet and their extra Yahtzees with them', () => {
    const start = withPlayers();
    const ada = id(start, 'Ada');
    const played = run(
      start,
      { type: 'score', playerId: ada, category: 'yahtzee', value: YAHTZEE_SCORE },
      { type: 'addBonus', playerId: ada },
    );
    const after = run(played, { type: 'removePlayer', id: ada });
    expect(after.players.map((p) => p.name)).toEqual(['Grace', 'Alan']);
    expect(after.turns).toEqual([]);
    expect(after.bonuses).toEqual([]);
  });

  it('hands the reducer its own state back for a player who is not there', () => {
    const start = withPlayers();
    expect(run(start, { type: 'removePlayer', id: 'nobody' })).toBe(start);
  });
});

describe('filling a box in', () => {
  it('records the score and moves play on to the next player', () => {
    const start = withPlayers();
    const after = run(start, {
      type: 'score',
      playerId: id(start, 'Ada'),
      category: 'fives',
      value: 15,
    });
    expect(after.turns).toHaveLength(1);
    expect(after.turns[0]).toMatchObject({ category: 'fives', value: 15 });
    expect(up(after)).toBe('Grace');
  });

  it('records a scratch as a turn like any other', () => {
    const start = withPlayers();
    const after = run(start, {
      type: 'score',
      playerId: id(start, 'Ada'),
      category: 'yahtzee',
      value: 0,
    });
    expect(after.turns).toHaveLength(1);
    expect(up(after)).toBe('Grace');
  });

  /**
   * The host fills in for whoever calls out a number, so the pointer follows
   * the player who was scored rather than stepping on from wherever it was.
   */
  it('moves play on from whoever was scored, not from the pointer', () => {
    const start = withPlayers();
    const after = run(start, {
      type: 'score',
      playerId: id(start, 'Alan'),
      category: 'chance',
      value: 21,
    });
    expect(up(after)).toBe('Ada');
  });

  it('wraps round at the end of the order', () => {
    const start = withPlayers();
    const after = run(start, {
      type: 'score',
      playerId: id(start, 'Alan'),
      category: 'ones',
      value: 3,
    });
    expect(up(after)).toBe('Ada');
  });

  it('refuses a number the box could not hold', () => {
    const start = withPlayers();
    const after = run(start, {
      type: 'score',
      playerId: id(start, 'Ada'),
      category: 'twos',
      value: 7,
    });
    expect(after).toBe(start);
  });

  it('refuses a score for somebody who is not playing', () => {
    const start = withPlayers();
    expect(run(start, { type: 'score', playerId: 'nobody', category: 'ones', value: 1 })).toBe(
      start,
    );
  });
});

describe('correcting a box', () => {
  const filled = () => {
    const start = withPlayers();
    return run(
      start,
      { type: 'score', playerId: id(start, 'Ada'), category: 'fours', value: 12 },
      { type: 'score', playerId: id(start, 'Grace'), category: 'fours', value: 8 },
    );
  };

  /**
   * Writing over a box that is already filled is somebody fixing a number, not
   * taking a turn: the turn was spent when the box was first written in, so
   * the order of play must not move on a second time.
   */
  it('replaces the number without spending another turn', () => {
    const state = filled();
    const after = run(state, {
      type: 'score',
      playerId: id(state, 'Ada'),
      category: 'fours',
      value: 16,
    });
    expect(after.turns).toHaveLength(2);
    expect(after.turns[0]!.value).toBe(16);
    expect(up(after)).toBe(up(state));
  });

  it('leaves the box in the order it was filled', () => {
    const state = filled();
    const after = run(state, {
      type: 'score',
      playerId: id(state, 'Ada'),
      category: 'fours',
      value: 16,
    });
    expect(after.turns.map((t) => t.id)).toEqual(state.turns.map((t) => t.id));
  });

  it('does nothing at all when the number has not changed', () => {
    const state = filled();
    expect(
      run(state, { type: 'score', playerId: id(state, 'Ada'), category: 'fours', value: 12 }),
    ).toBe(state);
  });

  it('empties a box and gives the turn back when it was the last one filled', () => {
    const state = filled();
    const after = run(state, {
      type: 'clearBox',
      playerId: id(state, 'Grace'),
      category: 'fours',
    });
    expect(after.turns).toHaveLength(1);
    expect(up(after)).toBe('Grace');
  });

  it('leaves the order alone when an older box is emptied', () => {
    const state = filled();
    const after = run(state, { type: 'clearBox', playerId: id(state, 'Ada'), category: 'fours' });
    expect(after.turns).toHaveLength(1);
    expect(up(after)).toBe(up(state));
  });

  it('does nothing for a box that was never filled', () => {
    const state = filled();
    expect(run(state, { type: 'clearBox', playerId: id(state, 'Ada'), category: 'chance' })).toBe(
      state,
    );
  });
});

describe('extra Yahtzees', () => {
  const rolled = () => {
    const start = withPlayers();
    return run(start, {
      type: 'score',
      playerId: id(start, 'Ada'),
      category: 'yahtzee',
      value: YAHTZEE_SCORE,
    });
  };

  it('is claimable once the box is worth 50, and does not end a turn', () => {
    const state = rolled();
    const after = run(state, { type: 'addBonus', playerId: id(state, 'Ada') });
    expect(after.bonuses).toHaveLength(1);
    expect(up(after)).toBe(up(state));
  });

  it('is refused while the Yahtzee box is scratched or empty', () => {
    const start = withPlayers();
    expect(run(start, { type: 'addBonus', playerId: id(start, 'Ada') })).toBe(start);

    const scratched = run(start, {
      type: 'score',
      playerId: id(start, 'Ada'),
      category: 'yahtzee',
      value: 0,
    });
    expect(run(scratched, { type: 'addBonus', playerId: id(start, 'Ada') })).toBe(scratched);
  });

  it('takes back the most recent one, and only from the right player', () => {
    const state = rolled();
    const ada = id(state, 'Ada');
    const twice = run(
      state,
      { type: 'addBonus', playerId: ada },
      { type: 'addBonus', playerId: ada },
    );
    const after = run(twice, { type: 'removeBonus', playerId: ada });
    expect(after.bonuses).toHaveLength(1);
    expect(run(after, { type: 'removeBonus', playerId: id(state, 'Grace') })).toBe(after);
  });
});

describe('undo', () => {
  it('takes back the last box and hands the turn to whoever filled it', () => {
    const start = withPlayers();
    const state = run(
      start,
      { type: 'score', playerId: id(start, 'Ada'), category: 'ones', value: 3 },
      { type: 'score', playerId: id(start, 'Grace'), category: 'ones', value: 2 },
    );
    const after = run(state, { type: 'undo' });
    expect(after.turns).toHaveLength(1);
    expect(up(after)).toBe('Grace');
  });

  it('does nothing on an untouched sheet', () => {
    const start = withPlayers();
    expect(run(start, { type: 'undo' })).toBe(start);
  });
});

describe('turn order', () => {
  it('can be rearranged before anybody has played, and not after', () => {
    const start = withPlayers();
    const moved = run(start, { type: 'movePlayer', id: id(start, 'Alan'), to: 0 });
    expect(moved.players.map((p) => p.name)).toEqual(['Alan', 'Ada', 'Grace']);
    expect(up(moved)).toBe('Alan');

    const played = run(moved, {
      type: 'score',
      playerId: id(moved, 'Alan'),
      category: 'ones',
      value: 2,
    });
    expect(run(played, { type: 'movePlayer', id: id(played, 'Ada'), to: 2 })).toBe(played);
  });

  it('can be handed to a chosen player', () => {
    const start = withPlayers();
    expect(up(run(start, { type: 'setCurrent', id: id(start, 'Alan') }))).toBe('Alan');
  });
});

describe('starting again', () => {
  const played = () => {
    const start = withPlayers();
    return run(
      start,
      { type: 'score', playerId: id(start, 'Ada'), category: 'yahtzee', value: YAHTZEE_SCORE },
      { type: 'addBonus', playerId: id(start, 'Ada') },
    );
  };

  it('keeps the players and clears every sheet', () => {
    const after = run(played(), { type: 'newGame' });
    expect(after.players).toHaveLength(3);
    expect(after.turns).toEqual([]);
    expect(after.bonuses).toEqual([]);
    expect(after.currentIndex).toBe(0);
  });

  it('clears the players too on a full reset', () => {
    expect(run(played(), { type: 'resetAll' })).toEqual(initialState);
  });

  it('renames a player without touching their sheet', () => {
    const state = played();
    const after = run(state, { type: 'renamePlayer', id: id(state, 'Ada'), name: 'Ada L' });
    expect(after.players[0]!.name).toBe('Ada L');
    expect(after.turns).toEqual(state.turns);
  });
});

describe('reading a stored game', () => {
  beforeEach(() => localStorage.clear());

  const store = (value: unknown) => localStorage.setItem(STORE_KEY, JSON.stringify(value));

  it('is null when nothing has been saved', () => {
    expect(readStored()).toBeNull();
  });

  it('reads back what was written', () => {
    const state = run(withPlayers(), {
      type: 'score',
      playerId: withPlayers().players[0]!.id,
      category: 'ones',
      value: 3,
    });
    store(state);
    expect(readStored()?.players).toHaveLength(3);
  });

  it('drops one malformed box rather than the whole game', () => {
    store({
      players: [{ id: 'a', name: 'Ada' }],
      turns: [
        { id: 't0', playerId: 'a', category: 'ones', value: 3 },
        { id: 't1', playerId: 'a', category: 'nonsense', value: 3 },
        { id: 't2', playerId: 'a', category: 'twos', value: 'lots' },
      ],
      bonuses: [],
      currentIndex: 0,
    });
    expect(readStored()?.turns).toHaveLength(1);
  });

  it('drops a box belonging to somebody who is no longer playing', () => {
    store({
      players: [{ id: 'a', name: 'Ada' }],
      turns: [
        { id: 't0', playerId: 'a', category: 'ones', value: 3 },
        { id: 't1', playerId: 'gone', category: 'twos', value: 4 },
      ],
      bonuses: [{ id: 'b0', playerId: 'gone' }],
      currentIndex: 0,
    });
    const stored = readStored();
    expect(stored?.turns).toHaveLength(1);
    expect(stored?.bonuses).toEqual([]);
  });

  it('pulls a turn pointer past the end of the roster back to the start', () => {
    store({ players: [{ id: 'a', name: 'Ada' }], turns: [], bonuses: [], currentIndex: 9 });
    expect(readStored()?.currentIndex).toBe(0);
  });

  it('copes with a save made before extra Yahtzees were counted', () => {
    store({ players: [{ id: 'a', name: 'Ada' }], turns: [], currentIndex: 0 });
    expect(readStored()?.bonuses).toEqual([]);
  });
});
