/**
 * A game, as the room sees it.
 *
 * The room holds an opaque snapshot, so this is where one becomes a real game
 * state and a real action. Both are validated: the action because it came off a
 * socket, and the state because a room created by an older deploy may not match
 * the shape this code expects.
 *
 * One function rather than one file per game, because the three were identical
 * apart from the names they imported, and the no-op rule below is subtle enough
 * that it should exist once.
 */
import { z } from 'zod';
import type { GameAction, Snapshot } from '../protocol';
import type { ApplyAction } from '../roomCore';
import type { IdSource } from '../../ids';

export interface RoomGame<A> {
  /** A fresh game, for a room that has just been made. */
  initial: () => Snapshot;
  /**
   * Binds the room's own id source, so ids are minted once by the authority
   * rather than by whichever client happened to act.
   */
  apply: (uid: IdSource) => ApplyAction<Snapshot>;
  /** Exposed for the tests that check what a hostile payload does. */
  decode: (action: GameAction) => A | null;
}

export function roomGame<S extends Snapshot, A>(spec: {
  stateSchema: z.ZodType<S>;
  actionSchema: z.ZodType<A>;
  createReducer: (uid: IdSource) => (state: S, action: A) => S;
  initialState: S;
}): RoomGame<A> {
  const decode = (action: GameAction): A | null => {
    const result = spec.actionSchema.safeParse(action);
    return result.success ? result.data : null;
  };

  return {
    initial: () => spec.initialState,
    decode,
    apply: (uid) => {
      const reducer = spec.createReducer(uid);
      return (snapshot, action) => {
        const state = spec.stateSchema.safeParse(snapshot);
        const decoded = decode(action);
        if (!state.success || !decoded) return null;

        const next = reducer(state.data, decoded);
        // A reducer hands back its input untouched when it declines an action.
        // The parse above made a fresh object, so return the original to keep
        // that signal intact: the room detects a no-op by identity.
        return next === state.data ? snapshot : next;
      };
    },
  };
}
