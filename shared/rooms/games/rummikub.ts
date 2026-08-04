/**
 * Rummikub, as the room sees it. The work is in `adapter.ts`; this names the
 * pieces and keeps the exports each caller already imports.
 */
import { createReducer, initialState, type Action } from '../../games/rummikub/reducer';
import { RummikubStateSchema, RummikubActionSchema } from '../../games/rummikub/schema';
import { roomGame } from './adapter';

const game = roomGame({
  stateSchema: RummikubStateSchema,
  actionSchema: RummikubActionSchema,
  createReducer,
  initialState,
});

export const rummikubInitialState = game.initial;
export const rummikubApply = game.apply;
export const decodeRummikubAction: (action: Parameters<typeof game.decode>[0]) => Action | null =
  game.decode;
