/**
 * Who may do what in a room.
 *
 * One pure function, used in three places: the room enforces it, the host
 * client never sees it bypassed, and the UI calls it to decide what to show.
 * Because the UI and the enforcement ask the same question, a button cannot
 * end up enabled for something the room will refuse.
 */
import { isArrayOf, isInteger, isRecord, isString } from '../shared/parse';
import type { ErrorCode, Game, GameAction, Role, Snapshot } from './protocol';

export interface Actor {
  role: Role;
  memberId: string;
  /** The player id this member is entering scores for, or null if watching. */
  seatId: string | null;
}

export type Permission = { ok: true } | { ok: false; code: ErrorCode };

const ALLOW: Permission = { ok: true };
const deny = (code: ErrorCode): Permission => ({ ok: false, code });

/**
 * The only parts of a game state the room needs. Each game reads differently -
 * Rummikub has no turn pointer at all - so this is the common shape they are
 * projected onto.
 */
export interface SeatView {
  playerIds: string[];
  /** Whose turn it is, or null for games without a turn pointer. */
  currentPlayerId: string | null;
  /** Who played the most recent turn, for self-scoped undo. */
  lastTurnPlayerId: string | null;
}

const idsOf = (value: unknown): string[] =>
  isArrayOf(value, isRecord) ? value.map((p) => p.id).filter(isString) : [];

const lastEntryPlayer = (value: unknown): string | null => {
  if (!isArrayOf(value, isRecord)) return null;
  const last = value[value.length - 1];
  return last && isString(last.playerId) ? last.playerId : null;
};

const withTurnPointer = (state: Snapshot): SeatView => {
  const playerIds = idsOf(state.players);
  const index = state.currentIndex;
  return {
    playerIds,
    currentPlayerId: isInteger(index) ? playerIds[index] ?? null : null,
    lastTurnPlayerId: lastEntryPlayer(state.turns),
  };
};

/** Rummikub scores whole rounds, so it has no turn pointer and no seat scoping. */
const roundBased = (state: Snapshot): SeatView => ({
  playerIds: idsOf(state.players),
  currentPlayerId: null,
  lastTurnPlayerId: null,
});

export const seatView: Record<Game, (state: Snapshot) => SeatView> = {
  scrabble: withTurnPointer,
  cricket: withTurnPointer,
  rummikub: roundBased,
};

/**
 * Actions only the host may take: they change the shape of the game rather than
 * adding to it. `adjust` and `setVariant` look mild but are not - one applies
 * arbitrary points, the other rescores everybody.
 */
const HOST_ONLY: Record<Game, readonly string[]> = {
  scrabble: ['addPlayers', 'removePlayer', 'setCurrent', 'adjust', 'newGame', 'resetAll'],
  cricket: ['addPlayers', 'removePlayer', 'setCurrent', 'setVariant', 'newGame', 'resetAll'],
  rummikub: ['addPlayers', 'removePlayer', 'recordRound', 'newGame', 'resetAll', 'undo'],
};

/** Actions a seated player may take, but only when it is their turn. */
const ON_YOUR_TURN: Record<Game, readonly string[]> = {
  scrabble: ['recordPlay', 'pass'],
  cricket: ['recordTurn'],
  rummikub: [],
};

/**
 * Undo is self-scoped: you may take back your own most recent turn, and only
 * while nobody has played since. It fixes the commonest real complaint - "I
 * typed 24 instead of 42" - without letting anyone rewrite history.
 */
const SELF_UNDO: Record<Game, boolean> = { scrabble: true, cricket: true, rummikub: false };

export function permit(
  game: Game,
  view: SeatView,
  actor: Actor,
  action: GameAction,
): Permission {
  const type = action.type;

  // The host runs the room, including entering for anyone who has not joined.
  if (actor.role === 'host') {
    return known(game, type) ? ALLOW : deny('unknown-action');
  }

  if (HOST_ONLY[game].includes(type)) return deny('host-only');

  if (type === 'undo' && SELF_UNDO[game]) {
    if (!actor.seatId) return deny('not-your-seat');
    return actor.seatId === view.lastTurnPlayerId ? ALLOW : deny('not-your-turn');
  }

  if (ON_YOUR_TURN[game].includes(type)) {
    if (!actor.seatId) return deny('not-your-seat');
    return actor.seatId === view.currentPlayerId ? ALLOW : deny('not-your-turn');
  }

  return deny('unknown-action');
}

const known = (game: Game, type: string): boolean =>
  HOST_ONLY[game].includes(type)
  || ON_YOUR_TURN[game].includes(type)
  || (type === 'undo' && SELF_UNDO[game]);

/** Convenience for the UI: may this actor take this kind of action right now? */
export const can = (game: Game, view: SeatView, actor: Actor, type: string): boolean =>
  permit(game, view, actor, { type }).ok;
