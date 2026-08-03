import { useEffect, useReducer } from 'react';
import { z } from 'zod';
import { initialState, reducer } from '@shared/games/rummikub/reducer';
import type { RummikubState } from '@shared/games/rummikub/types';

export { initialState, reducer, createReducer } from '@shared/games/rummikub/reducer';
export type { Action } from '@shared/games/rummikub/reducer';

export const STORE_KEY = 'games.rummikub.v1';

const PlayerSchema = z.object({ id: z.string(), name: z.string() });

const RoundSchema = z.object({
  id: z.string(),
  winnerId: z.string(),
  penalties: z.record(z.string(), z.number().finite()),
});

/**
 * A stored game is untrusted: it may predate a change to the shape, or have
 * been hand-edited. Anything malformed is dropped rather than allowed to crash
 * the render, which would leave the bad payload stuck in storage.
 */
const StoredSchema = z.object({
  players: z.array(PlayerSchema),
  rounds: z.array(z.unknown()),
});

export function readStored(): RummikubState | null {
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

  const { players } = result.data;
  const ids = new Set(players.map((p) => p.id));
  const rounds = result.data.rounds
    .map((r) => RoundSchema.safeParse(r))
    .filter((r) => r.success && ids.has(r.data.winnerId))
    .map((r) => r.data!);

  return { players, rounds };
}

export function useRummikub() {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => readStored() ?? init);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable; the session still works.
    }
  }, [state]);

  return { state, dispatch };
}
