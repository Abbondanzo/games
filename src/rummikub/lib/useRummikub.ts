import { useEffect, useReducer } from 'react';
import type { Player, Round, RummikubState } from './types';

const STORE_KEY = 'board-games.rummikub.v1';

let counter = 0;
const uid = (): string => `${Date.now().toString(36)}-${counter++}`;

export const initialState: RummikubState = { players: [], rounds: [] };

export type Action =
  | { type: 'addPlayers'; names: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'recordRound'; winnerId: string; penalties: Record<string, number> }
  | { type: 'undo' }
  | { type: 'newGame' }
  | { type: 'resetAll' };

export function reducer(state: RummikubState, action: Action): RummikubState {
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

const isPlayer = (v: unknown): v is Player =>
  typeof v === 'object' && v !== null
  && typeof (v as Player).id === 'string' && typeof (v as Player).name === 'string';

const isRound = (v: unknown): v is Round => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Round;
  return typeof r.id === 'string'
    && typeof r.winnerId === 'string'
    && typeof r.penalties === 'object' && r.penalties !== null
    && Object.values(r.penalties).every((n) => Number.isFinite(n));
};

/**
 * A stored game is untrusted input: it may predate a change to the shape, or
 * have been hand-edited. Anything malformed is dropped rather than allowed to
 * crash the render, which would leave the bad payload stuck in storage.
 */
function readStored(): RummikubState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RummikubState>;
    if (!Array.isArray(parsed.players) || !parsed.players.every(isPlayer)) return null;
    if (!Array.isArray(parsed.rounds)) return null;

    const players = parsed.players;
    const ids = new Set(players.map((p) => p.id));
    const rounds = parsed.rounds.filter((r) => isRound(r) && ids.has(r.winnerId));

    return { players, rounds };
  } catch {
    return null;
  }
}

export function useRummikub() {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => readStored() ?? init);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable; the session still works.
    }
  }, [state]);

  return { state, dispatch };
}
