import { z } from 'zod';
import { keepValid, readJson } from '../../shared/localStore';
import { useGameSession } from '../../rooms/session';
import type { TransportFactory } from '../../rooms/transport';
import { initialState, reducer } from '@shared/games/rummikub/reducer';
import { PlayerSchema, RoundSchema } from '@shared/games/rummikub/schema';
import type { RummikubState } from '@shared/games/rummikub/types';

export { initialState, reducer, createReducer } from '@shared/games/rummikub/reducer';
export type { Action } from '@shared/games/rummikub/reducer';

export const STORE_KEY = 'games.rummikub.v1';

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
  const stored = readJson(STORE_KEY, StoredSchema);
  if (!stored) return null;

  const { players } = stored;
  const ids = new Set(players.map((p) => p.id));

  return {
    players,
    rounds: keepValid(stored.rounds, RoundSchema, (r) => r.winnerId, ids),
  };
}

export function useRummikub(transport?: TransportFactory) {
  return useGameSession({
    game: 'rummikub',
    reducer,
    initialState,
    readStored,
    storeKey: STORE_KEY,
    transport,
  });
}
