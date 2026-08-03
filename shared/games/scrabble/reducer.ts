import { createIdSource, type IdSource } from '../../ids';
import type { GameState, ScoredWord, Turn } from './types';
import { BINGO_BONUS } from './scoring';

/** Ids are minted per module, so each game numbers its own. */
const defaultUid = createIdSource();

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

function apply(state: GameState, action: Action, uid: IdSource): GameState {
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

/**
 * Binds an id source to the reducer. The room server passes its own, so ids are
 * minted once by the authority rather than by whichever client happened to act.
 */
export const createReducer = (uid: IdSource = defaultUid) =>
  (state: GameState, action: Action): GameState => apply(state, action, uid);

/**
 * The ordinary reducer. Deliberately arity two so it drops straight into
 * useReducer and Array.reduce, neither of which would leave a third argument
 * alone.
 */
export const reducer = createReducer();
