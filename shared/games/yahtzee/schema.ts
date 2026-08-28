/**
 * Runtime shapes for Yahtzee, declared once and used wherever untrusted data
 * arrives: the room decoding an action off a socket, and the browser reading a
 * stored game. Types are inferred from these, so a schema and its type cannot
 * drift apart, and neither can the two sides of the wire.
 */
import { z } from 'zod';
import { CATEGORIES, isValidScore, YAHTZEE_SCORE } from './rules';

export const CategorySchema = z.enum([...CATEGORIES]);

/**
 * No box on the sheet pays more than a Yahtzee. The exact set a given box will
 * take is narrower still and is checked below, where the category is known.
 */
const ScoreSchema = z.int().min(0).max(YAHTZEE_SCORE);

export const PlayerSchema = z.object({ id: z.string(), name: z.string() });

export const TurnSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  category: CategorySchema,
  value: ScoreSchema,
});

export const BonusSchema = z.object({ id: z.string(), playerId: z.string() });

const Id = z.string().min(1).max(64);

const Actions = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addPlayers'), names: z.string().max(200) }),
  z.object({ type: z.literal('removePlayer'), id: Id }),
  // A seat number, so a paste of nonsense cannot ask for index 1e9.
  z.object({ type: z.literal('movePlayer'), id: Id, to: z.int().min(0).max(64) }),
  z.object({ type: z.literal('setCurrent'), id: Id }),
  z.object({
    type: z.literal('score'),
    playerId: Id,
    category: CategorySchema,
    value: ScoreSchema,
  }),
  z.object({ type: z.literal('clearBox'), playerId: Id, category: CategorySchema }),
  z.object({ type: z.literal('addBonus'), playerId: Id }),
  z.object({ type: z.literal('removeBonus'), playerId: Id }),
  z.object({ type: z.literal('renamePlayer'), id: Id, name: z.string().min(1).max(24) }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('newGame') }),
  z.object({ type: z.literal('resetAll') }),
]);

/**
 * A number is only a score if the box it is going into could hold it: 30 is a
 * large straight scratched down to nothing away from being a small one, and 7
 * is not a number any count of twos can make. The bound belongs here rather
 * than only in the reducer so a bad payload is refused rather than quietly
 * ignored, which is the difference between a wrong number and a broken sheet.
 */
export const YahtzeeActionSchema = Actions.refine(
  (action) => action.type !== 'score' || isValidScore(action.category, action.value),
  { message: 'that box cannot hold that score' },
);

/** The whole game state. Validated when the room reads it back from storage. */
export const YahtzeeStateSchema = z.object({
  players: z.array(PlayerSchema),
  turns: z.array(TurnSchema),
  bonuses: z.array(BonusSchema),
  currentIndex: z.int().nonnegative(),
});
