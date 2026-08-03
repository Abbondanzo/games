/**
 * Runtime shapes for cricket, declared once and used everywhere untrusted data
 * arrives: the room decoding an action off a socket, and the browser reading a
 * stored game. Types are inferred from these, so a schema and its type cannot
 * drift apart, and neither can the two sides of the wire.
 */
import { z } from 'zod';
import { TARGETS } from './rules';

/** Target 0 is a miss; everything else must be one of the seven real targets. */
export const TargetSchema = z.union([
  z.literal(0),
  ...TARGETS.map((t) => z.literal(t)),
]);

export const MultiplierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const DartSchema = z.object({
  target: TargetSchema,
  multiplier: MultiplierSchema,
});

export const VariantSchema = z.enum(['standard', 'cutthroat', 'nopoints']);

/** Three darts to a turn, so a longer list is not a throw anyone made. */
export const DARTS_PER_TURN = 3;

export const PlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Games stored before join points existed began with everyone at the board. */
  joinedAtTurn: z.int().nonnegative().catch(0),
});

export const TurnSchema = z.object({
  id: z.string(),
  playerId: z.string(),
  darts: z.array(DartSchema),
});

const Id = z.string().min(1).max(64);

export const CricketActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addPlayers'), names: z.string().max(200) }),
  z.object({ type: z.literal('removePlayer'), id: Id }),
  z.object({ type: z.literal('setCurrent'), id: Id }),
  z.object({ type: z.literal('setVariant'), variant: VariantSchema }),
  z.object({ type: z.literal('recordTurn'), darts: z.array(DartSchema).max(DARTS_PER_TURN) }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('newGame') }),
  z.object({ type: z.literal('resetAll') }),
]);
