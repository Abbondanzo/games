/**
 * Yahtzee, as the room sees it. The work is in `adapter.ts`; this names the
 * pieces and keeps the exports each caller already imports.
 */
import { createReducer, initialState, type Action } from '../../games/yahtzee/reducer';
import { YahtzeeStateSchema, YahtzeeActionSchema } from '../../games/yahtzee/schema';
import { roomGame } from './adapter';

const game = roomGame({
  stateSchema: YahtzeeStateSchema,
  actionSchema: YahtzeeActionSchema,
  createReducer,
  initialState,
});

export const yahtzeeInitialState = game.initial;
export const yahtzeeApply = game.apply;
export const decodeYahtzeeAction: (action: Parameters<typeof game.decode>[0]) => Action | null =
  game.decode;
