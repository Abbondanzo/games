import { describe, expect, it } from 'vitest';
import { cricketApply, cricketInitialState, decodeCricketAction } from './cricket';
import { CricketStateSchema } from '../../games/cricket/schema';
import type { GameAction } from '../protocol';

const decode = (action: GameAction) => decodeCricketAction(action);

describe('decoding a well-formed action', () => {
  it.each([
    [{ type: 'addPlayers', names: 'Ada, Grace' }],
    [{ type: 'removePlayer', id: 'p1' }],
    [{ type: 'setCurrent', id: 'p1' }],
    [{ type: 'setVariant', variant: 'cutthroat' }],
    [{ type: 'recordTurn', darts: [{ target: 20, multiplier: 3 }] }],
    [{ type: 'recordTurn', darts: [{ target: 0, multiplier: 1 }] }], // a miss
    [{ type: 'recordTurn', darts: [] }],
    [{ type: 'undo' }],
    [{ type: 'newGame' }],
    [{ type: 'resetAll' }],
  ] as [GameAction][])('accepts %o', (action) => {
    expect(decode(action)).toEqual(action);
  });

  it('drops fields the action does not declare', () => {
    expect(decode({ type: 'undo', sneaky: 'extra' })).toEqual({ type: 'undo' });
  });
});

/**
 * These are the ones that matter. `permit` only looks at the action's type, so
 * anything malformed that got past here would reach the reducer and throw
 * inside the room, taking the connection with it.
 */
describe('refusing a hostile payload', () => {
  it.each([
    ['a name that is not a string', { type: 'addPlayers', names: 42 }],
    ['a missing name', { type: 'addPlayers' }],
    ['a null name', { type: 'addPlayers', names: null }],
    ['an id that is not a string', { type: 'removePlayer', id: { evil: true } }],
    ['a missing id', { type: 'setCurrent' }],
    ['an unknown variant', { type: 'setVariant', variant: 'chaos' }],
    ['a missing variant', { type: 'setVariant' }],
    ['darts that are not an array', { type: 'recordTurn', darts: 'three' }],
    ['a dart that is not an object', { type: 'recordTurn', darts: ['t20'] }],
    ['a target off the board', { type: 'recordTurn', darts: [{ target: 14, multiplier: 1 }] }],
    ['a fractional target', { type: 'recordTurn', darts: [{ target: 20.5, multiplier: 1 }] }],
    ['a multiplier of four', { type: 'recordTurn', darts: [{ target: 20, multiplier: 4 }] }],
    ['a missing multiplier', { type: 'recordTurn', darts: [{ target: 20 }] }],
    ['an action type nobody handles', { type: 'dropTable' }],
  ] as [string, GameAction][])('refuses %s', (_label, action) => {
    expect(decode(action)).toBeNull();
  });

  // Three darts to a turn, so a longer list is not a throw anyone made.
  it('refuses more darts than a turn can hold', () => {
    const dart = { target: 20, multiplier: 1 };
    expect(decode({ type: 'recordTurn', darts: [dart, dart, dart] })).not.toBeNull();
    expect(decode({ type: 'recordTurn', darts: [dart, dart, dart, dart] })).toBeNull();
  });
});

describe('applying', () => {
  const uid = () => {
    let n = 0;
    return () => `id-${n++}`;
  };

  it('runs the real reducer with the room\'s own id source', () => {
    const apply = cricketApply(uid());
    const state = apply(cricketInitialState(), { type: 'addPlayers', names: 'Ada' });
    expect(CricketStateSchema.parse(state).players)
      .toEqual([{ id: 'id-0', name: 'Ada', joinedAtTurn: 0 }]);
  });

  it('returns null rather than throwing on a bad payload', () => {
    const apply = cricketApply(uid());
    expect(() => apply(cricketInitialState(), { type: 'addPlayers', names: 42 })).not.toThrow();
    expect(apply(cricketInitialState(), { type: 'addPlayers', names: 42 })).toBeNull();
  });

  // The room tells a declined action apart from an applied one by identity, and
  // validating the state on the way in would otherwise always produce a new object.
  it('hands back the very same snapshot when the reducer declines', () => {
    const apply = cricketApply(uid());
    const start = cricketInitialState();
    expect(apply(start, { type: 'undo' })).toBe(start);
  });

  it('returns a different object when something actually changed', () => {
    const apply = cricketApply(uid());
    const start = cricketInitialState();
    expect(apply(start, { type: 'addPlayers', names: 'Ada' })).not.toBe(start);
  });

  // Written by an older deploy, or hand-edited in storage.
  it('refuses a snapshot that is not a cricket game', () => {
    const apply = cricketApply(uid());
    expect(apply({ nonsense: true }, { type: 'undo' })).toBeNull();
  });

  // Without the decoder this exact payload reaches names.split(',') and throws.
  it('protects the reducer from the payload that would crash it', () => {
    const apply = cricketApply(uid());
    expect(apply(cricketInitialState(), { type: 'addPlayers', names: { toString: 1 } })).toBeNull();
  });
});
