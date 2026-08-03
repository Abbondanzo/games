import { useEffect, useReducer } from 'react';
import type { GameState, Player, ScoredWord, Turn } from './types';
import { BINGO_BONUS } from './scoring';

const STORE_KEY = 'board-games.scrabble.v1';

let counter = 0;
const uid = (): string => `${Date.now().toString(36)}-${counter++}`;

export const initialState: GameState = { players: [], turns: [], currentIndex: 0 };

export type Action =
  | { type: 'addPlayers'; names: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'setCurrent'; id: string }
  | { type: 'recordPlay'; words: ScoredWord[]; bingo: boolean }
  | { type: 'pass' }
  | { type: 'adjust'; playerId: string; points: number }
  | { type: 'undo' }
  | { type: 'newGame' }
  | { type: 'resetAll' }
  | { type: 'hydrate'; state: GameState };

const nextIndex = (state: GameState): number =>
  state.players.length ? (state.currentIndex + 1) % state.players.length : 0;

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'hydrate':
      return action.state;

    case 'addPlayers': {
      // "Ada, Grace" adds both - pasting a list is the fastest way to set up.
      const names = action.names.split(',').map((n) => n.trim()).filter(Boolean);
      if (!names.length) return state;
      return { ...state, players: [...state.players, ...names.map((name) => ({ id: uid(), name }))] };
    }

    case 'removePlayer': {
      const removedAt = state.players.findIndex((p) => p.id === action.id);
      if (removedAt === -1) return state;

      const players = state.players.filter((p) => p.id !== action.id);
      const turns = state.turns.filter((t) => t.playerId !== action.id);
      if (!players.length) return { players, turns, currentIndex: 0 };

      // Keep the same player up, not the same seat number. If the player who
      // was up is the one leaving, the next in order takes over - which is the
      // removed player's own index once everyone after them shifts down.
      const upNow = state.players[state.currentIndex]?.id;
      const stillHere = upNow !== undefined && upNow !== action.id
        ? players.findIndex((p) => p.id === upNow)
        : -1;

      return {
        players,
        turns,
        currentIndex: stillHere === -1 ? removedAt % players.length : stillHere,
      };
    }

    case 'setCurrent': {
      const idx = state.players.findIndex((p) => p.id === action.id);
      return idx === -1 ? state : { ...state, currentIndex: idx };
    }

    case 'recordPlay': {
      const player = state.players[state.currentIndex];
      // A bingo is a property of a play, so it cannot stand as a turn on its own.
      if (!player || !action.words.length) return state;
      const turn: Turn = {
        id: uid(),
        playerId: player.id,
        kind: 'play',
        words: action.words.map((w) => w.word),
        bingo: action.bingo,
        points: action.words.reduce((s, w) => s + w.points, 0) + (action.bingo ? BINGO_BONUS : 0),
      };
      return { ...state, turns: [...state.turns, turn], currentIndex: nextIndex(state) };
    }

    case 'pass': {
      const player = state.players[state.currentIndex];
      if (!player) return state;
      const turn: Turn = { id: uid(), playerId: player.id, kind: 'pass', words: [], bingo: false, points: 0 };
      return { ...state, turns: [...state.turns, turn], currentIndex: nextIndex(state) };
    }

    case 'adjust': {
      if (!action.points || !state.players.some((p) => p.id === action.playerId)) return state;
      const turn: Turn = {
        id: uid(), playerId: action.playerId, kind: 'adjust',
        words: [], bingo: false, points: Math.trunc(action.points),
      };
      // An end-of-game adjustment isn't a turn, so play order doesn't move.
      return { ...state, turns: [...state.turns, turn] };
    }

    case 'undo': {
      const last = state.turns[state.turns.length - 1];
      if (!last) return state;
      const turns = state.turns.slice(0, -1);
      if (last.kind === 'adjust' || !state.players.length) return { ...state, turns };

      // Hand the turn back to whoever played it. Stepping the seat back by one
      // would land on the wrong player if the order was changed since.
      const playedBy = state.players.findIndex((p) => p.id === last.playerId);
      return {
        ...state,
        turns,
        currentIndex: playedBy === -1
          ? (state.currentIndex - 1 + state.players.length) % state.players.length
          : playedBy,
      };
    }

    case 'newGame':
      return { ...state, turns: [], currentIndex: 0 };

    // Back to a blank slate, players included.
    case 'resetAll':
      return initialState;

    default:
      return state;
  }
}

const isPlayer = (v: unknown): v is Player =>
  typeof v === 'object' && v !== null
  && typeof (v as Player).id === 'string' && typeof (v as Player).name === 'string';

const isTurn = (v: unknown): v is Turn => {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Turn;
  return typeof t.id === 'string'
    && typeof t.playerId === 'string'
    && (t.kind === 'play' || t.kind === 'pass' || t.kind === 'adjust')
    && Array.isArray(t.words) && t.words.every((w) => typeof w === 'string')
    && typeof t.bingo === 'boolean'
    && Number.isFinite(t.points);
};

/**
 * A stored game is untrusted input: it may predate a change to the shape, or
 * have been hand-edited. Anything malformed is dropped rather than allowed to
 * crash the render, which would leave the bad payload stuck in storage.
 */
function readStored(): GameState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (!Array.isArray(parsed.players) || !parsed.players.every(isPlayer)) return null;
    if (!Array.isArray(parsed.turns)) return null;

    const players = parsed.players;
    const ids = new Set(players.map((p) => p.id));
    const turns = parsed.turns.filter((t) => isTurn(t) && ids.has(t.playerId));

    const index = parsed.currentIndex;
    const currentIndex = Number.isInteger(index) && index! >= 0 && index! < players.length
      ? index!
      : 0;

    return { players, turns, currentIndex };
  } catch {
    return null; // Corrupt or unreadable payload - start clean rather than crash.
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => readStored() ?? init);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable (private browsing); the session still works.
    }
  }, [state]);

  return { state, dispatch };
}
