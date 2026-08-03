/**
 * Rummikub, as the room sees it.
 *
 * The room holds an opaque snapshot, so this is where it becomes a real game
 * state and a real action. Both are validated: the action because it came off a
 * socket, and the state because a room created by an older deploy may not match
 * the shape this code expects.
 */
import { createReducer, initialState, type Action } from '../../games/rummikub/reducer';
import { RummikubStateSchema, RummikubActionSchema } from '../../games/rummikub/schema';
import type { GameAction, Snapshot } from '../protocol';
import type { ApplyAction } from '../roomCore';
import type { IdSource } from '../../ids';

export function decodeRummikubAction(action: GameAction): Action | null {
  const result = RummikubActionSchema.safeParse(action);
  return result.success ? result.data : null;
}

export const rummikubInitialState = (): Snapshot => initialState;

/**
 * Binds the room's own id source, so ids are minted once by the authority
 * rather than by whichever client happened to act.
 */
export function rummikubApply(uid: IdSource): ApplyAction<Snapshot> {
  const reducer = createReducer(uid);
  return (snapshot, action) => {
    const state = RummikubStateSchema.safeParse(snapshot);
    const decoded = decodeRummikubAction(action);
    if (!state.success || !decoded) return null;

    const next = reducer(state.data, decoded);
    // A reducer hands back its input untouched when it declines an action. The
    // parse above made a fresh object, so return the original to keep that
    // signal intact: the room detects a no-op by identity.
    return next === state.data ? snapshot : next;
  };
}
