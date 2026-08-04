/**
 * The room must play exactly the game people already play.
 *
 * Every action in a room takes a longer road than one played alone: it is
 * decoded from a frame, parsed against a zod schema that strips what it does
 * not declare, run, and parsed back. Any of those steps could quietly change
 * the outcome - a dropped field, a coerced number, a lost id. These run the
 * same script down both roads and demand identical results, so a regression in
 * the room path cannot hide behind the room path's own tests.
 */
import { describe, expect, it } from 'vitest';
import type { IdSource } from '../../ids';
import type { GameAction, Snapshot } from '../protocol';
import type { ApplyAction } from '../roomCore';

import { cricketApply } from './cricket';
import { scrabbleApply } from './scrabble';
import { rummikubApply } from './rummikub';
import { createReducer as cricketReducer, initialState as cricketStart } from '../../games/cricket/reducer';
import { createReducer as scrabbleReducer, initialState as scrabbleStart } from '../../games/scrabble/reducer';
import { createReducer as rummikubReducer, initialState as rummikubStart } from '../../games/rummikub/reducer';

/**
 * Ids are minted from a counter rather than the clock, so the two runs can be
 * compared directly instead of being normalised afterwards.
 */
const countingIds = (): IdSource => {
  let n = 0;
  return () => `id${n++}`;
};

/**
 * The room holds a snapshot rather than a typed state, which is the whole point
 * of the parse. `never` for the action is what lets one helper drive all three
 * reducers; each script below is typed as the wire union it really is.
 */
type Reducer<S> = (state: S, action: never) => S;

/**
 * Runs one script alone and the same script in a room, and hands back both.
 * Each run gets its own id source, started from the same place.
 */
function bothWays<S extends Snapshot>(
  start: S,
  makeReducer: (uid: IdSource) => Reducer<S>,
  makeApply: (uid: IdSource) => ApplyAction<Snapshot>,
  script: GameAction[],
): { solo: S; room: Snapshot } {
  const reducer = makeReducer(countingIds());
  const solo = script.reduce((state, action) => reducer(state, action as never), start);

  const apply = makeApply(countingIds());
  const room = script.reduce<Snapshot>((state, action) => apply(state, action) ?? state, start);

  return { solo, room };
}

/** Both roads, same destination. */
const agree = (runs: { solo: Snapshot; room: Snapshot }) =>
  expect(runs.room).toEqual(runs.solo);

describe('cricket', () => {
  const run = (script: GameAction[]) =>
    bothWays(cricketStart, cricketReducer, cricketApply, script);

  const t = (target: number, multiplier: number) => ({ target, multiplier });

  it('scores a whole game the same way', () => {
    const runs = run([
      { type: 'addPlayers', names: 'Ada, Grace, Alan' },
      { type: 'recordTurn', darts: [t(20, 3), t(20, 3), t(19, 1)] },
      { type: 'recordTurn', darts: [t(20, 1), t(0, 1), t(18, 2)] },
      { type: 'recordTurn', darts: [t(25, 2), t(17, 3), t(16, 1)] },
      { type: 'recordTurn', darts: [t(20, 3), t(20, 1), t(20, 1)] },
      { type: 'recordTurn', darts: [] },
      { type: 'recordTurn', darts: [t(19, 3), t(19, 3), t(19, 3)] },
    ]);
    agree(runs);
    // The script is worth checking too: parity over an empty game proves nothing.
    expect(runs.solo.turns).toHaveLength(5); // the empty throw is declined by both
  });

  it('rescores a switched variant the same way', () => {
    agree(run([
      { type: 'addPlayers', names: 'Ada, Grace, Alan' },
      { type: 'recordTurn', darts: [t(20, 3), t(20, 3), t(20, 3)] },
      { type: 'recordTurn', darts: [t(19, 1)] },
      { type: 'setVariant', variant: 'cutthroat' },
      { type: 'recordTurn', darts: [t(20, 3), t(20, 3), t(20, 3)] },
      { type: 'setVariant', variant: 'standard' },
    ]));
  });

  it('handles a player joining and leaving mid-game the same way', () => {
    agree(run([
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordTurn', darts: [t(20, 3), t(20, 3), t(20, 1)] },
      { type: 'recordTurn', darts: [t(19, 3)] },
      { type: 'addPlayers', names: 'Alan' },
      { type: 'recordTurn', darts: [t(20, 3)] },
      { type: 'removePlayer', id: 'id1' },
      { type: 'recordTurn', darts: [t(18, 3), t(18, 3), t(18, 3)] },
    ]));
  });

  it('undoes, renames and starts again the same way', () => {
    agree(run([
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordTurn', darts: [t(20, 3)] },
      { type: 'recordTurn', darts: [t(19, 3)] },
      { type: 'undo' },
      { type: 'renamePlayer', id: 'id0', name: 'Ada L' },
      { type: 'setCurrent', id: 'id1' },
      { type: 'recordTurn', darts: [t(17, 2)] },
      { type: 'newGame' },
      { type: 'recordTurn', darts: [t(16, 1)] },
    ]));
  });

  it('resets to nothing the same way', () => {
    const runs = run([
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordTurn', darts: [t(20, 3)] },
      { type: 'resetAll' },
    ]);
    agree(runs);
    expect(runs.room).toEqual(cricketStart);
  });
});

describe('scrabble', () => {
  const run = (script: GameAction[]) =>
    bothWays(scrabbleStart, scrabbleReducer, scrabbleApply, script);

  const word = (text: string, points: number) => ({ word: text, points });

  it('scores a whole game the same way', () => {
    const runs = run([
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordPlay', words: [word('QUARTZ', 44)], bingo: false },
      { type: 'recordPlay', words: [word('JAZZY', 33), word('AXE', 10)], bingo: false },
      { type: 'pass' },
      { type: 'recordPlay', words: [word('RETINAS', 64)], bingo: true },
    ]);
    agree(runs);
    expect(runs.solo.turns).toHaveLength(4);
  });

  it('adjusts, undoes and renames the same way', () => {
    agree(run([
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordPlay', words: [word('CWM', 10)], bingo: false },
      { type: 'adjust', playerId: 'id1', points: -6 },
      { type: 'undo' },
      { type: 'renamePlayer', id: 'id1', name: 'Grace H' },
      { type: 'recordPlay', words: [word('ZA', 11)], bingo: false },
    ]));
  });

  it('carries the bingo bonus across identically', () => {
    const runs = run([
      { type: 'addPlayers', names: 'Ada' },
      { type: 'recordPlay', words: [word('RETINAS', 14)], bingo: true },
    ]);
    agree(runs);
    expect(runs.solo.turns[0]?.points).toBe(64);
  });

  it('starts a new game the same way', () => {
    agree(run([
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordPlay', words: [word('OX', 9)], bingo: false },
      { type: 'newGame' },
      { type: 'recordPlay', words: [word('OX', 9)], bingo: false },
    ]));
  });
});

describe('rummikub', () => {
  const run = (script: GameAction[]) =>
    bothWays(rummikubStart, rummikubReducer, rummikubApply, script);

  it('scores a whole game the same way', () => {
    const runs = run([
      { type: 'addPlayers', names: 'Ada, Grace, Alan' },
      { type: 'recordRound', winnerId: 'id0', penalties: { id1: 24, id2: 41 } },
      { type: 'recordRound', winnerId: 'id2', penalties: { id0: 12, id1: 0 } },
      { type: 'recordRound', winnerId: 'id1', penalties: { id0: 30, id2: 8 } },
    ]);
    agree(runs);
    expect(runs.solo.rounds).toHaveLength(3);
  });

  it('treats a missing rack the same way', () => {
    agree(run([
      { type: 'addPlayers', names: 'Ada, Grace, Alan' },
      // Alan never sent his, which scores zero rather than being dropped.
      { type: 'recordRound', winnerId: 'id0', penalties: { id1: 24 } },
    ]));
  });

  it('undoes, removes and renames the same way', () => {
    agree(run([
      { type: 'addPlayers', names: 'Ada, Grace, Alan' },
      { type: 'recordRound', winnerId: 'id0', penalties: { id1: 24, id2: 41 } },
      { type: 'recordRound', winnerId: 'id1', penalties: { id0: 5, id2: 5 } },
      { type: 'undo' },
      { type: 'removePlayer', id: 'id2' },
      { type: 'renamePlayer', id: 'id0', name: 'Ada L' },
      { type: 'recordRound', winnerId: 'id1', penalties: { id0: 17 } },
    ]));
  });
});

/**
 * A room can outlive the code that made it, so a snapshot is parsed on the way
 * in as well as on the way out. That parse must not quietly reshape a good
 * state: an action arriving on an untouched game has to leave everything else
 * exactly as it was.
 */
describe('round-tripping a snapshot', () => {
  const cases: [string, Snapshot, (uid: IdSource) => ApplyAction<Snapshot>, GameAction[]][] = [
    ['cricket', cricketStart, cricketApply, [
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordTurn', darts: [{ target: 20, multiplier: 3 }] },
    ]],
    ['scrabble', scrabbleStart, scrabbleApply, [
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordPlay', words: [{ word: 'QI', points: 11 }], bingo: false },
    ]],
    ['rummikub', rummikubStart, rummikubApply, [
      { type: 'addPlayers', names: 'Ada, Grace' },
      { type: 'recordRound', winnerId: 'id0', penalties: { id1: 24 } },
    ]],
  ];

  it.each(cases)('%s survives being parsed and re-parsed', (_name, start, makeApply, script) => {
    const apply = makeApply(countingIds());
    const played = script.reduce<Snapshot>((state, action) => apply(state, action) ?? state, start);

    // An action the reducer declines still round-trips the state through zod.
    const after = apply(played, { type: 'removePlayer', id: 'nobody' }) ?? played;
    expect(after).toEqual(played);
  });

  it.each(cases)('%s reports a declined action as a no-op, not a change', (_name, start, makeApply, script) => {
    const apply = makeApply(countingIds());
    const played = script.reduce<Snapshot>((state, action) => apply(state, action) ?? state, start);

    // Identity is the signal the room uses to avoid bumping its revision.
    expect(apply(played, { type: 'removePlayer', id: 'nobody' })).toBe(played);
  });
});
