import { describe, expect, it } from 'vitest';
import { can, permit, seatView, type Actor } from './permissions';
import type { Game, Snapshot } from './protocol';

const ada = 'p-ada';
const grace = 'p-grace';

const host: Actor = { role: 'host', memberId: 'm-host', seatId: null };
const seatedAda: Actor = { role: 'player', memberId: 'm1', seatId: ada };
const seatedGrace: Actor = { role: 'player', memberId: 'm2', seatId: grace };
const watching: Actor = { role: 'player', memberId: 'm3', seatId: null };

/** Ada is up; Grace played the previous turn. */
const turnGame = (currentIndex = 0): Snapshot => ({
  players: [{ id: ada, name: 'Ada' }, { id: grace, name: 'Grace' }],
  currentIndex,
  turns: [{ id: 't1', playerId: grace }],
});

const view = (game: Game, state: Snapshot) => seatView[game](state);
const check = (game: Game, state: Snapshot, actor: Actor, type: string) =>
  permit(game, view(game, state), actor, { type });

describe('reading a game state', () => {
  it('projects a turn-based game onto players, current and last', () => {
    expect(view('cricket', turnGame(1))).toEqual({
      playerIds: [ada, grace],
      currentPlayerId: grace,
      lastTurnPlayerId: grace,
    });
  });

  it('gives Rummikub no turn pointer, because it has none', () => {
    const state: Snapshot = { players: [{ id: ada, name: 'Ada' }], rounds: [] };
    expect(view('rummikub', state)).toEqual({
      playerIds: [ada],
      currentPlayerId: null,
      lastTurnPlayerId: null,
    });
  });

  // The projection reads whatever the room was sent, which may be junk.
  it.each([
    ['no players key', {}],
    ['players not an array', { players: 'Ada' }],
    ['players missing ids', { players: [{ name: 'Ada' }] }],
    ['a fractional index', { players: [{ id: ada }], currentIndex: 0.5 }],
    ['an out-of-range index', { players: [{ id: ada }], currentIndex: 99 }],
    ['turns not an array', { players: [{ id: ada }], turns: 7 }],
  ])('survives %s', (_label, state) => {
    expect(() => view('cricket', state as Snapshot)).not.toThrow();
    expect(view('cricket', state as Snapshot).currentPlayerId).toBeNull();
  });
});

describe('the host', () => {
  const everything: Record<Game, string[]> = {
    scrabble: ['addPlayers', 'removePlayer', 'setCurrent', 'adjust', 'newGame', 'resetAll', 'recordPlay', 'pass', 'undo'],
    cricket: ['addPlayers', 'removePlayer', 'setCurrent', 'setVariant', 'newGame', 'resetAll', 'recordTurn', 'undo'],
    rummikub: ['addPlayers', 'removePlayer', 'recordRound', 'newGame', 'resetAll', 'undo'],
  };

  for (const [game, types] of Object.entries(everything) as [Game, string[]][]) {
    it.each(types)(`may ${game} %s`, (type) => {
      expect(check(game, turnGame(), host, type).ok).toBe(true);
    });
  }

  // Even the host cannot dispatch something no reducer would recognise.
  it('is still refused an action that does not exist', () => {
    expect(check('cricket', turnGame(), host, 'deleteEverything'))
      .toEqual({ ok: false, code: 'unknown-action' });
  });
});

describe('a seated player', () => {
  it.each([
    ['cricket', 'recordTurn'],
    ['scrabble', 'recordPlay'],
    ['scrabble', 'pass'],
  ] as const)('may %s %s on their own turn', (game, type) => {
    expect(check(game, turnGame(0), seatedAda, type).ok).toBe(true);
  });

  it.each([
    ['cricket', 'recordTurn'],
    ['scrabble', 'recordPlay'],
  ] as const)('may not %s %s on another player\'s turn', (game, type) => {
    expect(check(game, turnGame(0), seatedGrace, type))
      .toEqual({ ok: false, code: 'not-your-turn' });
  });

  it.each([
    ['scrabble', ['addPlayers', 'removePlayer', 'setCurrent', 'adjust', 'newGame', 'resetAll']],
    ['cricket', ['addPlayers', 'removePlayer', 'setCurrent', 'setVariant', 'newGame', 'resetAll']],
  ] as const)('is refused every host-only %s action', (game, types) => {
    for (const type of types) {
      expect(check(game, turnGame(), seatedAda, type), type)
        .toEqual({ ok: false, code: 'host-only' });
    }
  });
});

describe('undoing your own turn', () => {
  // Grace played the last turn, so only Grace may take it back.
  it('is allowed for whoever played the last turn', () => {
    expect(check('cricket', turnGame(), seatedGrace, 'undo').ok).toBe(true);
  });

  it('is refused to anyone else', () => {
    expect(check('cricket', turnGame(), seatedAda, 'undo'))
      .toEqual({ ok: false, code: 'not-your-turn' });
  });

  it('is refused when no turn has been played', () => {
    const empty: Snapshot = { players: [{ id: ada }], currentIndex: 0, turns: [] };
    expect(check('cricket', empty, seatedAda, 'undo'))
      .toEqual({ ok: false, code: 'not-your-turn' });
  });

  // Rummikub rounds are collective, so there is no "your" round to take back.
  it('is host-only in Rummikub', () => {
    const state: Snapshot = { players: [{ id: ada }], rounds: [] };
    expect(check('rummikub', state, seatedAda, 'undo'))
      .toEqual({ ok: false, code: 'host-only' });
  });
});

describe('someone just watching', () => {
  it.each(['recordTurn', 'undo'])('may not %s', (type) => {
    expect(check('cricket', turnGame(), watching, type))
      .toEqual({ ok: false, code: 'not-your-seat' });
  });

  it('may not touch host controls either', () => {
    expect(check('cricket', turnGame(), watching, 'newGame'))
      .toEqual({ ok: false, code: 'host-only' });
  });
});

describe('Rummikub guests', () => {
  const state: Snapshot = { players: [{ id: ada }, { id: grace }], rounds: [] };

  // Rounds record everyone's rack at once, so they belong to the host. Guests
  // take part by submitting their own rack, which is room state, not an action.
  it('cannot record a round even when seated', () => {
    expect(check('rummikub', state, seatedAda, 'recordRound'))
      .toEqual({ ok: false, code: 'host-only' });
  });
});

describe('can()', () => {
  it('answers the same question as permit, for the UI', () => {
    expect(can('cricket', view('cricket', turnGame(0)), seatedAda, 'recordTurn')).toBe(true);
    expect(can('cricket', view('cricket', turnGame(0)), seatedGrace, 'recordTurn')).toBe(false);
  });
});
