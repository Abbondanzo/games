import { createIdSource, type IdSource } from '../../ids';
import { movedTo, parseNames, renamedTo } from '../players';
import type { Round, RummikubState } from './types';

/** Ids are minted per module, so each game numbers its own. */
const defaultUid = createIdSource();

export const initialState: RummikubState = { players: [], rounds: [] };

export type Action =
  | { type: 'addPlayers'; names: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'movePlayer'; id: string; to: number }
  | { type: 'recordRound'; winnerId: string; penalties: Record<string, number> }
  | { type: 'undo' }
  | { type: 'newGame' }
  | { type: 'renamePlayer'; id: string; name: string }
  | { type: 'resetAll' };

function apply(state: RummikubState, action: Action, uid: IdSource): RummikubState {
  switch (action.type) {
    case 'addPlayers': {
      const names = parseNames(action.names);
      if (!names.length) return state;
      return { ...state, players: [...state.players, ...names.map((name) => ({ id: uid(), name }))] };
    }

    case 'removePlayer': {
      // Handing back the same state signals a no-op, which is how the room
      // knows not to bump its revision and tell everyone about nothing.
      if (!state.players.some((p) => p.id === action.id)) return state;
      const players = state.players.filter((p) => p.id !== action.id);
      // Rounds this player won make no sense without them, so they go. Rounds
      // they merely lost are kept and rescored without their penalty.
      const rounds = state.rounds.filter((r) => r.winnerId !== action.id);
      return { players, rounds };
    }

    case 'movePlayer': {
      // No turn order here, but the board is still read in this order, and a
      // game already under way should not have its rows shuffled.
      if (state.rounds.length) return state;
      const players = movedTo(state.players, action.id, action.to);
      return players ? { ...state, players } : state;
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

    case 'renamePlayer': {
      const players = renamedTo(state.players, action.id, action.name);
      return players ? { ...state, players } : state;
    }

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
