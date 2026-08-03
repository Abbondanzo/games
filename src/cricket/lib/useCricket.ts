import { useEffect, useReducer } from 'react';
import type { CricketState, Dart, Player, Turn, Variant } from './types';

const STORE_KEY = 'board-games.cricket.v1';

let counter = 0;
const uid = (): string => `${Date.now().toString(36)}-${counter++}`;

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

export function reducer(state: CricketState, action: Action): CricketState {
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

const isPlayer = (v: unknown): v is Player =>
  typeof v === 'object' && v !== null
  && typeof (v as Player).id === 'string' && typeof (v as Player).name === 'string';

const isDart = (v: unknown): v is Dart => {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Dart;
  return Number.isInteger(d.target) && (d.multiplier === 1 || d.multiplier === 2 || d.multiplier === 3);
};

const isTurn = (v: unknown): v is Turn => {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Turn;
  return typeof t.id === 'string'
    && typeof t.playerId === 'string'
    && Array.isArray(t.darts) && t.darts.every(isDart);
};

/**
 * A stored game is untrusted input: it may predate a change to the shape, or
 * have been hand-edited. A turn missing its darts would throw during the
 * replay, and because that happens while rendering, the bad payload would
 * never be overwritten - so anything malformed is dropped here instead.
 */
function readStored(): CricketState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CricketState>;
    if (!Array.isArray(parsed.players) || !parsed.players.every(isPlayer)) return null;
    if (!Array.isArray(parsed.turns)) return null;

    // Games stored before join points existed began with everyone at the board.
    const players = parsed.players.map((p) => ({
      ...p,
      joinedAtTurn: Number.isInteger(p.joinedAtTurn) && p.joinedAtTurn >= 0 ? p.joinedAtTurn : 0,
    }));
    const ids = new Set(players.map((p) => p.id));
    const turns = parsed.turns.filter((t) => isTurn(t) && ids.has(t.playerId));

    const index = parsed.currentIndex;
    const currentIndex = Number.isInteger(index) && index! >= 0 && index! < players.length
      ? index!
      : 0;

    return {
      players,
      turns,
      currentIndex,
      variant: parsed.variant === 'cutthroat' || parsed.variant === 'nopoints'
        ? parsed.variant
        : 'standard',
    };
  } catch {
    return null;
  }
}

export function useCricket() {
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
