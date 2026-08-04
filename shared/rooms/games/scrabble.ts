/**
 * Scrabble, as the room sees it. The work is in `adapter.ts`; this names the
 * pieces and keeps the exports each caller already imports.
 */
import { createReducer, initialState, type Action } from '../../games/scrabble/reducer';
import { GameStateSchema, ScrabbleActionSchema } from '../../games/scrabble/schema';
import { roomGame } from './adapter';

const game = roomGame({
  stateSchema: GameStateSchema,
  actionSchema: ScrabbleActionSchema,
  createReducer,
  initialState,
});

export const scrabbleInitialState = game.initial;
export const scrabbleApply = game.apply;
export const decodeScrabbleAction: (action: Parameters<typeof game.decode>[0]) => Action | null =
  game.decode;
