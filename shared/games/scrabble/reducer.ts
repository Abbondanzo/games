import { createIdSource, type IdSource } from '../../ids';
import { advance, indexAfterRemoval, parseNames, renamedTo } from '../players';
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
  | { type: 'renamePlayer'; id: string; name: string }
  | { type: 'resetAll' };

const nextIndex = (state: GameState): number =>
  advance(state.currentIndex, state.players.length);

function apply(state: GameState, action: Action, uid: IdSource): GameState {
  switch (action.type) {
    case 'addPlayers': {
      const names = parseNames(action.names);
      if (!names.length) return state;
      return { ...state, players: [...state.players, ...names.map((name) => ({ id: uid(), name }))] };
    }

    case 'removePlayer': {
      const removedAt = state.players.findIndex((p) => p.id === action.id);
      if (removedAt === -1) return state;

      return {
        players: state.players.filter((p) => p.id !== action.id),
        turns: state.turns.filter((t) => t.playerId !== action.id),
        currentIndex: indexAfterRemoval(state.players, state.currentIndex, action.id),
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

    case 'renamePlayer': {
      const players = renamedTo(state.players, action.id, action.name);
      return players ? { ...state, players } : state;
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
