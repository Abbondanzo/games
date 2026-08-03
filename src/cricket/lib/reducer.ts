import { createIdSource, type IdSource } from '../../shared/ids';
import {
  isArrayOf, isInteger, isOneOf, isRecord, isString, parseJson,
} from '../../shared/parse';
import type { CricketState, Dart, Player, Turn, Variant } from './types';

export const STORE_KEY = 'games.cricket.v1';

/** Ids are minted per module, so each game numbers its own. */
const defaultUid = createIdSource();

export const initialState: CricketState = {
  players: [],
  turns: [],
  currentIndex: 0,
  variant: 'standard',
};

export type Action =
  | { type: 'addPlayers'; names: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'setCurrent'; id: string }
  | { type: 'setVariant'; variant: Variant }
  | { type: 'recordTurn'; darts: Dart[] }
  | { type: 'undo' }
  | { type: 'newGame' }
  | { type: 'resetAll' };

const nextIndex = (state: CricketState): number =>
  state.players.length ? (state.currentIndex + 1) % state.players.length : 0;

function apply(state: CricketState, action: Action, uid: IdSource): CricketState {
  switch (action.type) {
    case 'addPlayers': {
      const names = action.names.split(',').map((n) => n.trim()).filter(Boolean);
      if (!names.length) return state;
      // Stamping the join point keeps darts already thrown scored as they were.
      const joinedAtTurn = state.turns.length;
      return {
        ...state,
        players: [...state.players, ...names.map((name) => ({ id: uid(), name, joinedAtTurn }))],
      };
    }

    case 'removePlayer': {
      const removedAt = state.players.findIndex((p) => p.id === action.id);
      if (removedAt === -1) return state;

      const players = state.players.filter((p) => p.id !== action.id);
      const turns = state.turns.filter((t) => t.playerId !== action.id);
      if (!players.length) return { ...state, players, turns, currentIndex: 0 };

      // Keep the same player up, not the same seat number. If the player who
      // was up is the one leaving, the next in order takes over.
      const upNow = state.players[state.currentIndex]?.id;
      const stillHere = upNow !== undefined && upNow !== action.id
        ? players.findIndex((p) => p.id === upNow)
        : -1;

      return {
        ...state,
        players,
        turns,
        currentIndex: stillHere === -1 ? removedAt % players.length : stillHere,
      };
    }

    case 'setCurrent': {
      const idx = state.players.findIndex((p) => p.id === action.id);
      return idx === -1 ? state : { ...state, currentIndex: idx };
    }

    // Only darts are stored; points are derived by replaying them under the
    // current variant. Switching mode therefore just rescores, losing nothing.
    case 'setVariant':
      return action.variant === state.variant ? state : { ...state, variant: action.variant };

    case 'recordTurn': {
      const player = state.players[state.currentIndex];
      if (!player || !action.darts.length) return state;
      const turn: Turn = { id: uid(), playerId: player.id, darts: action.darts };
      return { ...state, turns: [...state.turns, turn], currentIndex: nextIndex(state) };
    }

    case 'undo': {
      const last = state.turns[state.turns.length - 1];
      if (!last || !state.players.length) return state;

      // Hand the turn back to whoever threw it, rather than stepping the seat
      // back by one, which lands on the wrong player if the order was changed.
      const thrownBy = state.players.findIndex((p) => p.id === last.playerId);
      return {
        ...state,
        turns: state.turns.slice(0, -1),
        currentIndex: thrownBy === -1
          ? (state.currentIndex - 1 + state.players.length) % state.players.length
          : thrownBy,
      };
    }

    case 'newGame':
      return { ...state, turns: [], currentIndex: 0 };

    // Back to a blank slate, players included. The chosen mode is a preference
    // rather than game data, so it carries over.
    case 'resetAll':
      return { ...initialState, variant: state.variant };

    default:
      return state;
  }
}

/**
 * Binds an id source to the reducer. The room server passes its own, so ids are
 * minted once by the authority rather than by whichever client happened to act.
 */
export const createReducer = (uid: IdSource = defaultUid) =>
  (state: CricketState, action: Action): CricketState => apply(state, action, uid);

/**
 * The ordinary reducer. Deliberately arity two so it drops straight into
 * useReducer and Array.reduce, neither of which would leave a third argument
 * alone.
 */
export const reducer = createReducer();

const MULTIPLIERS = [1, 2, 3] as const;

const isDart = (v: unknown): v is Dart =>
  isRecord(v) && isInteger(v.target) && isOneOf(v.multiplier, MULTIPLIERS);

const isTurn = (v: unknown): v is Turn =>
  isRecord(v) && isString(v.id) && isString(v.playerId) && isArrayOf(v.darts, isDart);

const VARIANTS = ['standard', 'cutthroat', 'nopoints'] as const;

/**
 * Built rather than asserted, because a stored player may predate join points.
 * A guard claiming `v is Player` would be lying about a field it never checked.
 */
const toPlayer = (v: unknown): Player | null => {
  if (!isRecord(v) || !isString(v.id) || !isString(v.name)) return null;
  const joined = v.joinedAtTurn;
  return {
    id: v.id,
    name: v.name,
    // Games stored before join points existed began with everyone at the board.
    joinedAtTurn: isInteger(joined) && joined >= 0 ? joined : 0,
  };
};

/**
 * A stored game is untrusted input: it may predate a change to the shape, or
 * have been hand-edited. A turn missing its darts would throw during the
 * replay, and because that happens while rendering, the bad payload would
 * never be overwritten - so anything malformed is dropped here instead.
 */
export function readStored(): CricketState | null {
  // getItem itself can throw in private browsing, so the read stays guarded.
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return null;
  if (!Array.isArray(parsed.players) || !Array.isArray(parsed.turns)) return null;

  const players: Player[] = [];
  for (const candidate of parsed.players) {
    const player = toPlayer(candidate);
    if (!player) return null;
    players.push(player);
  }

  const ids = new Set(players.map((p) => p.id));
  const turns = parsed.turns.filter((t): t is Turn => isTurn(t) && ids.has(t.playerId));

  const index = parsed.currentIndex;
  const currentIndex = isInteger(index) && index >= 0 && index < players.length ? index : 0;

  return {
    players,
    turns,
    currentIndex,
    variant: isOneOf(parsed.variant, VARIANTS) ? parsed.variant : 'standard',
  };
}
