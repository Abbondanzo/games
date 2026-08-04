/**
 * Runtime shapes for Rummikub, declared once and used wherever untrusted data
 * arrives: the room decoding an action off a socket, and the browser reading a
 * stored game.
 */
import { z } from 'zod';

export const PlayerSchema = z.object({ id: z.string(), name: z.string() });

/** A rack cannot be worth more than every tile in the box. */
const PenaltySchema = z.number().int().min(0).max(1000);

export const RoundSchema = z.object({
  id: z.string(),
  winnerId: z.string(),
  // The same bounds the wire accepts. A stored game is no more trustworthy than
  // a frame off a socket, and a negative penalty would pay the loser.
  penalties: z.record(z.string(), PenaltySchema),
});

const Id = z.string().min(1).max(64);

export const RummikubActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addPlayers'), names: z.string().max(200) }),
  z.object({ type: z.literal('removePlayer'), id: Id }),
  z.object({
    type: z.literal('recordRound'),
    winnerId: Id,
    penalties: z.record(Id, PenaltySchema),
  }),
  z.object({ type: z.literal('renamePlayer'), id: Id, name: z.string().min(1).max(24) }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('newGame') }),
  z.object({ type: z.literal('resetAll') }),
]);

/** The whole game state. Validated when the room reads it back from storage. */
export const RummikubStateSchema = z.object({
  players: z.array(PlayerSchema),
  rounds: z.array(RoundSchema),
});
