import { z } from 'zod';
import { clampIndex, keepValid, readJson } from '../../shared/localStore';
import { useGameSession } from '../../rooms/session';
import type { TransportFactory } from '../../rooms/transport';
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
  const stored = readJson(STORE_KEY, StoredSchema);
  if (!stored) return null;

  const { players, currentIndex, variant } = stored;
  const ids = new Set(players.map((p) => p.id));

  return {
    players,
    turns: keepValid(stored.turns, TurnSchema, (t) => t.playerId, ids),
    currentIndex: clampIndex(currentIndex, players.length),
    variant,
  };
}

export function useCricket(transport?: TransportFactory) {
  return useGameSession({
    game: 'cricket',
    reducer,
    initialState,
    readStored,
    storeKey: STORE_KEY,
    transport,
  });
}
