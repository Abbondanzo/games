import { z } from 'zod';
import { clampIndex, keepValid, readJson } from '../../shared/localStore';
import { useGameSession } from '../../rooms/session';
import type { TransportFactory } from '../../rooms/transport';
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
  const stored = readJson(STORE_KEY, StoredSchema);
  if (!stored) return null;

  const { players, currentIndex } = stored;
  const ids = new Set(players.map((p) => p.id));

  return {
    players,
    turns: keepValid(stored.turns, TurnSchema, (t) => t.playerId, ids),
    currentIndex: clampIndex(currentIndex, players.length),
  };
}

export function useGame(transport?: TransportFactory) {
  return useGameSession({
    game: 'scrabble',
    reducer,
    initialState,
    readStored,
    storeKey: STORE_KEY,
    transport,
  });
}
