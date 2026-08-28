import { createIdSource, type IdSource } from '../../ids';
import { advance, indexAfterRemoval, movedTo, parseNames, renamedTo } from '../players';
import { isValidScore, YAHTZEE_SCORE } from './rules';
import type { Category, Turn, YahtzeeState } from './types';

/** Ids are minted per module, so each game numbers its own. */
const defaultUid = createIdSource();

export const initialState: YahtzeeState = {
  players: [],
  turns: [],
  bonuses: [],
  currentIndex: 0,
};

export type Action =
  | { type: 'addPlayers'; names: string }
  | { type: 'removePlayer'; id: string }
  | { type: 'movePlayer'; id: string; to: number }
  | { type: 'setCurrent'; id: string }
  | { type: 'score'; playerId: string; category: Category; value: number }
  | { type: 'clearBox'; playerId: string; category: Category }
  | { type: 'addBonus'; playerId: string }
  | { type: 'removeBonus'; playerId: string }
  | { type: 'undo' }
  | { type: 'newGame' }
  | { type: 'renamePlayer'; id: string; name: string }
  | { type: 'resetAll' };

const heldYahtzee = (state: YahtzeeState, playerId: string): boolean =>
  state.turns.some(
    (t) => t.playerId === playerId && t.category === 'yahtzee' && t.value === YAHTZEE_SCORE,
  );

function apply(state: YahtzeeState, action: Action, uid: IdSource): YahtzeeState {
  switch (action.type) {
    case 'addPlayers': {
      const names = parseNames(action.names);
      if (!names.length) return state;
      // A latecomer simply starts with an empty sheet: nothing already written
      // down depends on who else was at the table, so nothing is rescored.
      return {
        ...state,
        players: [...state.players, ...names.map((name) => ({ id: uid(), name }))],
      };
    }

    case 'removePlayer': {
      if (!state.players.some((p) => p.id === action.id)) return state;
      return {
        ...state,
        players: state.players.filter((p) => p.id !== action.id),
        turns: state.turns.filter((t) => t.playerId !== action.id),
        bonuses: state.bonuses.filter((b) => b.playerId !== action.id),
        currentIndex: indexAfterRemoval(state.players, state.currentIndex, action.id),
      };
    }

    case 'movePlayer': {
      // The roster order is the order of play, so it is only worth rearranging
      // before anybody has used it.
      if (state.turns.length) return state;
      const players = movedTo(state.players, action.id, action.to);
      if (!players) return state;
      return { ...state, players, currentIndex: 0 };
    }

    case 'setCurrent': {
      const idx = state.players.findIndex((p) => p.id === action.id);
      return idx === -1 ? state : { ...state, currentIndex: idx };
    }

    case 'score': {
      const index = state.players.findIndex((p) => p.id === action.playerId);
      if (index === -1) return state;
      if (!isValidScore(action.category, action.value)) return state;

      const at = state.turns.findIndex(
        (t) => t.playerId === action.playerId && t.category === action.category,
      );

      if (at !== -1) {
        // The box was already filled, so this is somebody correcting a number
        // rather than taking a turn. The order of play is untouched: it was
        // spent when the box was first written in.
        if (state.turns[at]!.value === action.value) return state;
        return {
          ...state,
          turns: state.turns.map((t, i) => (i === at ? { ...t, value: action.value } : t)),
        };
      }

      const turn: Turn = {
        id: uid(),
        playerId: action.playerId,
        category: action.category,
        value: action.value,
      };
      // Play moves on from whoever just wrote a box in, not from the pointer,
      // so a host entering for whoever calls out a score still leaves the
      // table pointing at the next player round.
      return {
        ...state,
        turns: [...state.turns, turn],
        currentIndex: advance(index, state.players.length),
      };
    }

    case 'clearBox': {
      const at = state.turns.findIndex(
        (t) => t.playerId === action.playerId && t.category === action.category,
      );
      if (at === -1) return state;

      // Emptying the box that was filled most recently hands the turn back to
      // whoever filled it, exactly as undo does. Emptying an older one leaves
      // the order alone: everybody has played since, so nobody is owed a turn.
      const wasLast = at === state.turns.length - 1;
      const filledBy = state.players.findIndex((p) => p.id === action.playerId);
      return {
        ...state,
        turns: state.turns.filter((_, i) => i !== at),
        currentIndex: wasLast && filledBy !== -1 ? filledBy : state.currentIndex,
      };
    }

    case 'addBonus': {
      if (!state.players.some((p) => p.id === action.playerId)) return state;
      // An extra Yahtzee is only extra once the box itself has paid 50.
      if (!heldYahtzee(state, action.playerId)) return state;
      return { ...state, bonuses: [...state.bonuses, { id: uid(), playerId: action.playerId }] };
    }

    case 'removeBonus': {
      const at = state.bonuses.map((b) => b.playerId).lastIndexOf(action.playerId);
      if (at === -1) return state;
      return { ...state, bonuses: state.bonuses.filter((_, i) => i !== at) };
    }

    case 'undo': {
      const last = state.turns[state.turns.length - 1];
      if (!last || !state.players.length) return state;

      // Hand the turn back to whoever took it rather than stepping the pointer
      // back one, which lands on the wrong player once anybody has left.
      const takenBy = state.players.findIndex((p) => p.id === last.playerId);
      return {
        ...state,
        turns: state.turns.slice(0, -1),
        currentIndex:
          takenBy === -1
            ? (state.currentIndex - 1 + state.players.length) % state.players.length
            : takenBy,
      };
    }

    case 'renamePlayer': {
      const players = renamedTo(state.players, action.id, action.name);
      return players ? { ...state, players } : state;
    }

    case 'newGame':
      return { ...state, turns: [], bonuses: [], currentIndex: 0 };

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
export const createReducer =
  (uid: IdSource = defaultUid) =>
  (state: YahtzeeState, action: Action): YahtzeeState =>
    apply(state, action, uid);

/**
 * The ordinary reducer. Deliberately arity two so it drops straight into
 * useReducer and Array.reduce, neither of which would leave a third argument
 * alone.
 */
export const reducer = createReducer();
