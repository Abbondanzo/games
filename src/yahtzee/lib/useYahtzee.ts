import { z } from 'zod';
import { clampIndex, keepValid, readJson } from '../../shared/localStore';
import { useGameSession } from '../../rooms/session';
import type { TransportFactory } from '../../rooms/transport';
import { initialState, reducer } from '@shared/games/yahtzee/reducer';
import type { YahtzeeState } from '@shared/games/yahtzee/types';
import { BonusSchema, PlayerSchema, TurnSchema } from '@shared/games/yahtzee/schema';

export { initialState, reducer, createReducer } from '@shared/games/yahtzee/reducer';
export type { Action } from '@shared/games/yahtzee/reducer';

export const STORE_KEY = 'games.yahtzee.v1';

/**
 * A stored game is untrusted: it may predate a change to the shape, or have
 * been hand-edited. A box holding something that is not a number would be added
 * into a total during the render, and because that happens while rendering the
 * bad payload would never be overwritten - so anything malformed is dropped
 * here instead, one box at a time.
 */
const StoredSchema = z.object({
  players: z.array(PlayerSchema),
  turns: z.array(z.unknown()),
  bonuses: z.array(z.unknown()).catch([]),
  currentIndex: z.int().nonnegative().catch(0),
});

export function readStored(): YahtzeeState | null {
  const stored = readJson(STORE_KEY, StoredSchema);
  if (!stored) return null;

  const { players, currentIndex } = stored;
  const ids = new Set(players.map((p) => p.id));

  return {
    players,
    turns: keepValid(stored.turns, TurnSchema, (t) => t.playerId, ids),
    bonuses: keepValid(stored.bonuses, BonusSchema, (b) => b.playerId, ids),
    currentIndex: clampIndex(currentIndex, players.length),
  };
}

export function useYahtzee(transport?: TransportFactory) {
  return useGameSession({
    game: 'yahtzee',
    reducer,
    initialState,
    readStored,
    storeKey: STORE_KEY,
    transport,
  });
}
