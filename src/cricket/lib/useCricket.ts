import { useEffect, useReducer } from 'react';
import { z } from 'zod';
import { initialState, reducer } from '@shared/games/cricket/reducer';
import type { CricketState } from '@shared/games/cricket/types';
import { PlayerSchema, TurnSchema } from '@shared/games/cricket/schema';

export { initialState, reducer, createReducer } from '@shared/games/cricket/reducer';
export type { Action } from '@shared/games/cricket/reducer';

export const STORE_KEY = 'games.cricket.v1';

/**
 * A stored game is untrusted: it may predate a change to the shape, or have
 * been hand-edited. A turn missing its darts would throw during the replay, and
 * because that happens while rendering, the bad payload would never be
 * overwritten - so anything malformed is dropped here instead.
 */
const StoredSchema = z.object({
  players: z.array(PlayerSchema),
  turns: z.array(z.unknown()),
  currentIndex: z.int().nonnegative().catch(0),
  variant: z.enum(['standard', 'cutthroat', 'nopoints']).catch('standard'),
});

export function readStored(): CricketState | null {
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

  const { players, currentIndex, variant } = result.data;
  const ids = new Set(players.map((p) => p.id));
  const turns = result.data.turns
    .map((t) => TurnSchema.safeParse(t))
    .filter((r) => r.success && ids.has(r.data.playerId))
    .map((r) => r.data!);

  return {
    players,
    turns,
    currentIndex: currentIndex < players.length ? currentIndex : 0,
    variant,
  };
}

export function useCricket() {
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
