import { useEffect, useReducer } from 'react';
import { z } from 'zod';
import { initialState, reducer } from '@shared/games/scrabble/reducer';
import { PlayerSchema, TurnSchema } from '@shared/games/scrabble/schema';
import type { GameState } from '@shared/games/scrabble/types';

export { initialState, reducer, createReducer } from '@shared/games/scrabble/reducer';
export type { Action } from '@shared/games/scrabble/reducer';

export const STORE_KEY = 'games.scrabble.v1';

/**
 * A stored game is untrusted: it may predate a change to the shape, or have
 * been hand-edited. Players are all-or-nothing, since a game with a mangled
 * roster is not recoverable, but a single bad turn is dropped rather than
 * losing the whole game. An out-of-range current player falls back to the
 * first, which would otherwise leave the game unable to accept a turn at all.
 */
const StoredSchema = z.object({
  players: z.array(PlayerSchema),
  turns: z.array(z.unknown()),
  currentIndex: z.int().nonnegative().catch(0),
});

export function readStored(): GameState | null {
  // getItem itself can throw in private browsing, so the read stays guarded.
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = StoredSchema.safeParse(parsed);
  if (!result.success) return null;

  const { players, currentIndex } = result.data;
  const ids = new Set(players.map((p) => p.id));
  const turns = result.data.turns
    .map((t) => TurnSchema.safeParse(t))
    .filter((r) => r.success && ids.has(r.data.playerId))
    .map((r) => r.data!);

  return {
    players,
    turns,
    currentIndex: currentIndex < players.length ? currentIndex : 0,
  };
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
