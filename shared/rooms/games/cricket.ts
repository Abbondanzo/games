/**
 * Cricket, as the room sees it.
 *
 * The room runs the game's real reducer, so an action arriving off a socket has
 * to be narrowed to a real action first. The protocol only checks that an
 * action has a type; the payload is this game's business. Without that check a
 * payload like `{ type: 'addPlayers', names: 42 }` would reach
 * `names.split(',')` and throw inside the room.
 *
 * Declared as one schema so the rules read top to bottom and a new action is a
 * new line rather than a new function.
 */
import { createReducer, initialState, type Action } from '../../games/cricket/reducer';
import { CricketActionSchema } from '../../games/cricket/schema';
import type { CricketState } from '../../games/cricket/types';
import type { GameAction } from '../protocol';
import type { ApplyAction } from '../roomCore';
import type { IdSource } from '../../ids';

/**
 * The schema is written against the action union, so if a reducer arm gains a
 * field and this does not, it will not compile.
 */
export function decodeCricketAction(action: GameAction): Action | null {
  const result = CricketActionSchema.safeParse(action);
  return result.success ? result.data : null;
}

/** A fresh cricket game for a new room. */
export const cricketInitialState = (): CricketState => initialState;

/**
 * Binds the room's own id source, so ids are minted once by the authority
 * rather than by whichever client happened to act.
 */
export function cricketApply(uid: IdSource): ApplyAction<CricketState> {
  const reducer = createReducer(uid);
  return (state, action) => {
    const decoded = decodeCricketAction(action);
    return decoded ? reducer(state, decoded) : null;
  };
}
