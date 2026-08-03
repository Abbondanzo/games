/**
 * Cricket, as the room sees it.
 *
 * The room runs the game's real reducer, so the action arriving off a socket
 * has to be narrowed to a real action first. `permit` only inspects the
 * action's type, so without this a payload like
 * `{ type: 'addPlayers', names: 42 }` would reach `names.split(',')` and throw
 * inside the room. Every field is checked here; the reducer is only ever handed
 * something it can cope with.
 */
import { isArrayOf, isInteger, isOneOf, isRecord, isString } from '../../shared/parse';
import { createReducer, initialState, type Action } from '../../cricket/lib/reducer';
import { TARGETS } from '../../cricket/lib/cricket';
import type { CricketState, Dart, Variant } from '../../cricket/lib/types';
import type { GameAction } from '../protocol';
import type { ApplyAction } from '../roomCore';
import type { IdSource } from '../../shared/ids';

const MULTIPLIERS = [1, 2, 3] as const;
const VARIANTS = ['standard', 'cutthroat', 'nopoints'] as const;

/** A miss is target 0; everything else must be one of the seven real targets. */
const isTarget = (v: unknown): v is Dart['target'] =>
  v === 0 || (isInteger(v) && (TARGETS as readonly number[]).includes(v));

const isDart = (v: unknown): v is Dart =>
  isRecord(v) && isTarget(v.target) && isOneOf(v.multiplier, MULTIPLIERS);

const isVariant = (v: unknown): v is Variant => isOneOf(v, VARIANTS);

/** Three per turn, so anything longer is not a throw anyone made. */
const MAX_DARTS = 3;

export function decodeCricketAction(action: GameAction): Action | null {
  switch (action.type) {
    case 'addPlayers':
      return isString(action.names) ? { type: 'addPlayers', names: action.names } : null;

    case 'removePlayer':
      return isString(action.id) ? { type: 'removePlayer', id: action.id } : null;

    case 'setCurrent':
      return isString(action.id) ? { type: 'setCurrent', id: action.id } : null;

    case 'setVariant':
      return isVariant(action.variant) ? { type: 'setVariant', variant: action.variant } : null;

    case 'recordTurn':
      return isArrayOf(action.darts, isDart) && action.darts.length <= MAX_DARTS
        ? { type: 'recordTurn', darts: action.darts }
        : null;

    case 'undo':
      return { type: 'undo' };

    case 'newGame':
      return { type: 'newGame' };

    case 'resetAll':
      return { type: 'resetAll' };

    default:
      return null;
  }
}

/** A fresh cricket game for a new room. */
export const cricketInitialState = (): CricketState => initialState;

/**
 * Binds the room's own id source, so ids are minted once by the authority
 * rather than by whichever client happened to act.
 */
export function cricketApply(uid: IdSource): ApplyAction<CricketState> {
  const reducer = createReducer(uid);
  return (state, action) => {
    const decoded = decodeCricketAction(action);
    return decoded ? reducer(state, decoded) : null;
  };
}
