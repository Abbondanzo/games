import { createIdSource, type IdSource } from '../../shared/ids';
import {
  isArrayOf, isFiniteNumber, isRecord, isRecordOf, isString, parseJson,
} from '../../shared/parse';
import type { Player, Round, RummikubState } from './types';

export const STORE_KEY = 'games.rummikub.v1';

/** Ids are minted per module, so each game numbers its own. */
const defaultUid = createIdSource();

export const initialState: RummikubState = { players: [], rounds: [] };

export type Action =
  | { type: 'addPlayers'; names: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'recordRound'; winnerId: string; penalties: Record<string, number> }
  | { type: 'undo' }
  | { type: 'newGame' }
  | { type: 'resetAll' };

function apply(state: RummikubState, action: Action, uid: IdSource): RummikubState {
  switch (action.type) {
    case 'addPlayers': {
      const names = action.names.split(',').map((n) => n.trim()).filter(Boolean);
      if (!names.length) return state;
      return { ...state, players: [...state.players, ...names.map((name) => ({ id: uid(), name }))] };
    }

    case 'removePlayer': {
      const players = state.players.filter((p) => p.id !== action.id);
      // Rounds this player won make no sense without them, so they go. Rounds
      // they merely lost are kept and rescored without their penalty.
      const rounds = state.rounds.filter((r) => r.winnerId !== action.id);
      return { players, rounds };
    }

    case 'recordRound': {
      if (!state.players.some((p) => p.id === action.winnerId)) return state;
      const penalties = Object.fromEntries(
        Object.entries(action.penalties)
          .filter(([id, value]) => id !== action.winnerId && Number.isFinite(value) && value > 0)
          .map(([id, value]) => [id, Math.round(value)]),
      );
      const round: Round = { id: uid(), winnerId: action.winnerId, penalties };
      return { ...state, rounds: [...state.rounds, round] };
    }

    case 'undo':
      return state.rounds.length ? { ...state, rounds: state.rounds.slice(0, -1) } : state;

    case 'newGame':
      return { ...state, rounds: [] };

    case 'resetAll':
      return initialState;

    default:
      return state;
  }
}

/**
 * Binds an id source to the reducer. The room server passes its own, so ids are
 * minted once by the authority rather than by whichever client happened to act.
 */
export const createReducer = (uid: IdSource = defaultUid) =>
  (state: RummikubState, action: Action): RummikubState => apply(state, action, uid);

/**
 * The ordinary reducer. Deliberately arity two so it drops straight into
 * useReducer and Array.reduce, neither of which would leave a third argument
 * alone.
 */
export const reducer = createReducer();

const isPlayer = (v: unknown): v is Player =>
  isRecord(v) && isString(v.id) && isString(v.name);

const isRound = (v: unknown): v is Round =>
  isRecord(v)
  && isString(v.id)
  && isString(v.winnerId)
  && isRecordOf(v.penalties, isFiniteNumber);

/**
 * A stored game is untrusted input: it may predate a change to the shape, or
 * have been hand-edited. Anything malformed is dropped rather than allowed to
 * crash the render, which would leave the bad payload stuck in storage.
 */
export function readStored(): RummikubState | null {
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
  if (!isArrayOf(parsed.players, isPlayer)) return null;
  if (!Array.isArray(parsed.rounds)) return null;

  const players = parsed.players;
  const ids = new Set(players.map((p) => p.id));
  const rounds = parsed.rounds.filter((r): r is Round => isRound(r) && ids.has(r.winnerId));

  return { players, rounds };
}
