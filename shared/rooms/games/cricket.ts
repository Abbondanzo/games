/**
 * Cricket, as the room sees it. The work is in `adapter.ts`; this names the
 * pieces and keeps the exports each caller already imports.
 */
import { createReducer, initialState, type Action } from '../../games/cricket/reducer';
import { CricketStateSchema, CricketActionSchema } from '../../games/cricket/schema';
import { roomGame } from './adapter';

const game = roomGame({
  stateSchema: CricketStateSchema,
  actionSchema: CricketActionSchema,
  createReducer,
  initialState,
});

export const cricketInitialState = game.initial;
export const cricketApply = game.apply;
export const decodeCricketAction: (action: Parameters<typeof game.decode>[0]) => Action | null =
  game.decode;
