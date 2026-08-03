import { createIdSource, type IdSource } from '../../ids';
import type { CricketState, Dart, Turn, Variant } from './types';

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
