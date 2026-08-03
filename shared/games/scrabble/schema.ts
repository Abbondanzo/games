/**
 * Runtime shapes for Scrabble, declared once and used wherever untrusted data
 * arrives: the room decoding an action off a socket, and the browser reading a
 * stored game.
 */
import { z } from 'zod';

export const PlayerSchema = z.object({ id: z.string(), name: z.string() });

export const TurnSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  kind: z.enum(['play', 'pass', 'adjust']),
  words: z.array(z.string()),
  bingo: z.boolean(),
  points: z.number().finite(),
});

const Id = z.string().min(1).max(64);

/** A word already scored by the client, which the reducer only sums. */
const ScoredWordSchema = z.object({
  word: z.string().max(15),
  points: z.number().int().min(0).max(2000),
});

/** A play can form several words at once, but not an unbounded number. */
const MAX_WORDS_PER_PLAY = 8;

/** Adjustments settle unplayed tiles, so they are small and can be negative. */
const AdjustmentSchema = z.number().int().min(-500).max(500);

export const ScrabbleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addPlayers'), names: z.string().max(200) }),
  z.object({ type: z.literal('removePlayer'), id: Id }),
  z.object({ type: z.literal('setCurrent'), id: Id }),
  z.object({
    type: z.literal('recordPlay'),
    words: z.array(ScoredWordSchema).max(MAX_WORDS_PER_PLAY),
    bingo: z.boolean(),
  }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('adjust'), playerId: Id, points: AdjustmentSchema }),
  z.object({ type: z.literal('renamePlayer'), id: Id, name: z.string().min(1).max(24) }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('newGame') }),
  z.object({ type: z.literal('resetAll') }),
]);

/** The whole game state. Validated when the room reads it back from storage. */
export const GameStateSchema = z.object({
  players: z.array(PlayerSchema),
  turns: z.array(TurnSchema),
  currentIndex: z.int().nonnegative(),
});
