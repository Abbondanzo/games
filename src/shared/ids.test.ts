import { describe, expect, it } from 'vitest';
import { createIdSource } from './ids';
import { createReducer as createScrabble } from '../scrabble/lib/reducer';
import { createReducer as createCricket } from '../cricket/lib/reducer';
import { createReducer as createRummikub } from '../rummikub/lib/reducer';
import { initialState as scrabbleInit } from '../scrabble/lib/reducer';
import { initialState as cricketInit } from '../cricket/lib/reducer';
import { initialState as rummikubInit } from '../rummikub/lib/reducer';

describe('createIdSource', () => {
  it('counts independently per source', () => {
    const seq = (id: string) => id.split('-')[1];
    const a = createIdSource();
    const b = createIdSource();

    expect(seq(a())).toBe('0');
    expect(seq(a())).toBe('1');
    expect(seq(b())).toBe('0'); // b is unaffected by a
  });
});

/**
 * The room server binds its own id source so that ids are minted once by the
 * authority. These prove the seam works for every game.
 */
describe('createReducer with an injected id source', () => {
  const fixed = () => {
    let n = 0;
    return () => `server-${n++}`;
  };

  it('mints Scrabble player ids from the injected source', () => {
    const reducer = createScrabble(fixed());
    const state = reducer(scrabbleInit, { type: 'addPlayers', names: 'Ada, Grace' });
    expect(state.players.map((p) => p.id)).toEqual(['server-0', 'server-1']);
  });

  it('mints cricket turn ids from the injected source', () => {
    const reducer = createCricket(fixed());
    let state = reducer(cricketInit, { type: 'addPlayers', names: 'Ada' });
    state = reducer(state, { type: 'recordTurn', darts: [{ target: 20, multiplier: 3 }] });
    expect(state.players[0]!.id).toBe('server-0');
    expect(state.turns[0]!.id).toBe('server-1');
  });

  it('mints Rummikub round ids from the injected source', () => {
    const reducer = createRummikub(fixed());
    let state = reducer(rummikubInit, { type: 'addPlayers', names: 'Ada, Grace' });
    state = reducer(state, { type: 'recordRound', winnerId: 'server-0', penalties: {} });
    expect(state.rounds[0]!.id).toBe('server-2');
  });

  it('is deterministic: the same actions and source give the same ids', () => {
    const run = () => {
      const reducer = createScrabble(fixed());
      return reducer(scrabbleInit, { type: 'addPlayers', names: 'Ada, Grace, Alan' });
    };
    expect(run()).toEqual(run());
  });
});

describe('the default reducer export', () => {
  // Array.reduce passes an index as the third argument, so a third positional
  // parameter on the reducer would be filled with a number.
  it('takes exactly two arguments', async () => {
    const { reducer } = await import('../scrabble/lib/reducer');
    expect(reducer.length).toBe(2);
  });
});
