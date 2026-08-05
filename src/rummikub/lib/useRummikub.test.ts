import { describe, expect, it } from 'vitest';
import { initialState, reducer, type Action } from './useRummikub';
import type { RummikubState } from '@shared/games/rummikub/types';

const run = (state: RummikubState, ...actions: Action[]): RummikubState =>
  actions.reduce(reducer, state);

const withPlayers = (): RummikubState =>
  run(initialState, { type: 'addPlayers', names: 'Ada, Grace, Alan' });

const names = (s: RummikubState) => s.players.map((p) => p.name);

describe('players', () => {
  it('splits a comma-separated paste', () => {
    expect(names(withPlayers())).toEqual(['Ada', 'Grace', 'Alan']);
  });

  it('ignores empty input', () => {
    expect(run(initialState, { type: 'addPlayers', names: ' , ' }).players).toHaveLength(0);
  });
});

describe('recording a round', () => {
  const scored = (): RummikubState => {
    const s = withPlayers();
    const [a, g, l] = s.players;
    return run(s, {
      type: 'recordRound',
      winnerId: a!.id,
      penalties: { [g!.id]: 24, [l!.id]: 41 },
    });
  };

  it('stores the winner and every penalty', () => {
    const s = scored();
    expect(s.rounds).toHaveLength(1);
    expect(Object.values(s.rounds[0]!.penalties)).toEqual([24, 41]);
  });

  it('rejects a winner who is not playing', () => {
    const s = withPlayers();
    expect(run(s, { type: 'recordRound', winnerId: 'nobody', penalties: {} })).toBe(s);
  });

  // The winner went out, so by definition they hold nothing.
  it('discards a penalty recorded against the winner', () => {
    const s = withPlayers();
    const [a, g] = s.players;
    const after = run(s, {
      type: 'recordRound',
      winnerId: a!.id,
      penalties: { [a!.id]: 50, [g!.id]: 10 },
    });
    expect(after.rounds[0]!.penalties[a!.id]).toBeUndefined();
    expect(after.rounds[0]!.penalties[g!.id]).toBe(10);
  });

  it('drops zero and nonsense penalties rather than storing them', () => {
    const s = withPlayers();
    const [a, g, l] = s.players;
    const after = run(s, {
      type: 'recordRound',
      winnerId: a!.id,
      penalties: { [g!.id]: 0, [l!.id]: Number.NaN },
    });
    expect(after.rounds[0]!.penalties).toEqual({});
  });

  it('allows a clean round where nobody was left holding anything', () => {
    const s = withPlayers();
    const after = run(s, { type: 'recordRound', winnerId: s.players[0]!.id, penalties: {} });
    expect(after.rounds).toHaveLength(1);
  });
});

describe('removing a player', () => {
  const played = (): RummikubState => {
    const s = withPlayers();
    const [a, g, l] = s.players;
    return run(
      s,
      { type: 'recordRound', winnerId: a!.id, penalties: { [g!.id]: 24, [l!.id]: 41 } },
      { type: 'recordRound', winnerId: g!.id, penalties: { [a!.id]: 10, [l!.id]: 5 } },
    );
  };

  it('keeps rounds they only lost, and rescores them', () => {
    const s = played();
    const after = run(s, { type: 'removePlayer', id: s.players[2]!.id }); // Alan never won
    expect(after.rounds).toHaveLength(2);
    expect(names(after)).toEqual(['Ada', 'Grace']);
  });

  // A round is defined by who went out, so it cannot survive without them.
  it('deletes rounds they won', () => {
    const s = played();
    const after = run(s, { type: 'removePlayer', id: s.players[0]!.id }); // Ada won round 1
    expect(after.rounds).toHaveLength(1);
    expect(after.rounds[0]!.winnerId).toBe(s.players[1]!.id);
  });
});

describe('undo, new game and reset', () => {
  const played = (): RummikubState => {
    const s = withPlayers();
    return run(s, { type: 'recordRound', winnerId: s.players[0]!.id, penalties: {} });
  };

  it('undo drops the last round', () => {
    expect(run(played(), { type: 'undo' }).rounds).toHaveLength(0);
  });

  it('undo is a no-op with no history', () => {
    const s = withPlayers();
    expect(run(s, { type: 'undo' })).toBe(s);
  });

  it('new game clears rounds and keeps players', () => {
    const after = run(played(), { type: 'newGame' });
    expect(after.rounds).toHaveLength(0);
    expect(names(after)).toEqual(['Ada', 'Grace', 'Alan']);
  });

  it('reset all clears players too', () => {
    const after = run(played(), { type: 'resetAll' });
    expect(after.rounds).toHaveLength(0);
    expect(after.players).toHaveLength(0);
  });
});
