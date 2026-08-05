/**
 * The room wire protocol.
 *
 * Shared verbatim by the browser and the Worker, so it stays free of React,
 * the DOM and any Cloudflare type.
 *
 * Every frame is untrusted, so shapes are declared once as zod schemas and the
 * TypeScript types are inferred from them. That means the runtime check and the
 * compile-time type cannot drift apart, and unknown keys are dropped rather
 * than carried along: what comes out of a decode is exactly what is declared
 * here and nothing else.
 */
import { z } from 'zod';

/**
 * The client and the room server deploy separately, and a precached client can
 * be weeks old, so the two are routinely different versions.
 *
 * Bump this whenever one side gains something the other cannot understand. That
 * includes adding a client-to-server message: an older room will reject a frame
 * it has never heard of, which looks to the player like the button is broken.
 * Only server-to-client additions are genuinely safe, because an old client
 * ignores what it cannot read.
 *
 * 2: added closeRoom, roundOpen, rackSubmit, roundCancel.
 * 3: added leave.
 * 4: a room that will not have a device back now says why, in the socket's
 *    close code. Bumped although nothing was added to a frame, because a client
 *    that predates it retries a room that has ended forever, and telling that
 *    client to refresh is the only way to stop it.
 * 5: added makeHost, and movePlayer as a game action.
 * 6: added allowBack, and the list of removed people it acts on.
 */
export const PROTOCOL_VERSION = 6;

/** Which side is behind, worked out from the version in the welcome. */
export type VersionGap = 'app' | 'room';

export const compareProtocol = (roomVersion: number): VersionGap | null => {
  if (roomVersion < PROTOCOL_VERSION) return 'room';
  if (roomVersion > PROTOCOL_VERSION) return 'app';
  return null;
};

/** Said without mentioning versions, servers or deploys. */
export const VERSION_MESSAGES: Record<VersionGap, string> = {
  room: 'This room needs updating before everything here will work.',
  app: 'This app is out of date. Refresh to get the latest.',
};

export const GameSchema = z.enum(['scrabble', 'cricket', 'rummikub']);
export type Game = z.infer<typeof GameSchema>;
export const GAMES = GameSchema.options;

export const RoleSchema = z.enum(['host', 'player']);
export type Role = z.infer<typeof RoleSchema>;

/** A game state, opaque here: only the game's own reducer gives it meaning. */
export type Snapshot = Record<string, unknown>;
const SnapshotSchema = z.record(z.string(), z.unknown());

/**
 * A game action. The type is checked here; the payload is checked by the game
 * that owns it, since only that game knows what its actions carry.
 */
export const GameActionSchema = z.looseObject({ type: z.string().max(40) });
export type GameAction = z.infer<typeof GameActionSchema>;

/** Everything that can go wrong, in a form the UI can turn into plain English. */
export const ErrorCodeSchema = z.enum([
  'bad-message',
  'host-only',
  'not-your-seat',
  'not-your-turn',
  'rate-limited',
  'room-full',
  'room-locked',
  'kicked-out',
  'stale-rev',
  'too-large',
  'unknown-action',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export const ERROR_CODES = ErrorCodeSchema.options;

/* ─────────────────────────── shared shapes ─────────────────────────── */

/** Long enough for a generated id, short enough that nobody can send a novel. */
const Id = z.string().min(1).max(64);
const Name = z.string().max(24);
const Rev = z.int().nonnegative();

export const MemberSchema = z.object({
  memberId: z.string(),
  name: z.string(),
  role: RoleSchema,
  seatId: z.string().nullable(),
  online: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

/**
 * A Rummikub round being collected. Every player enters their own rack and the
 * host commits when they are in, so this is room state rather than a game
 * action: it is session scratch that dies with the room, and keeping it out of
 * the game state means RummikubState and its storage never had to change.
 */
export const PendingRoundSchema = z.object({
  winnerId: z.string(),
  racks: z.record(z.string(), z.number().int().min(0)),
});
export type PendingRound = z.infer<typeof PendingRoundSchema>;

/**
 * Somebody the host removed, as the host sees them.
 *
 * `ref` is the member id they had at the time: a public handle, so the host can
 * let them back without the device key it is really keyed on ever leaving the
 * room.
 */
export const RemovedSchema = z.object({ ref: z.string(), name: z.string() });
export type Removed = z.infer<typeof RemovedSchema>;

export const RoomViewSchema = z.object({
  members: z.array(MemberSchema),
  locked: z.boolean(),
  pending: PendingRoundSchema.nullable(),
  /** Only ever sent to the host; empty for everybody else. */
  removed: z.array(RemovedSchema).catch([]),
});
export type RoomView = z.infer<typeof RoomViewSchema>;

/** Who caused a state change, so the UI can say "Grace scored" rather than just redraw. */
export const CauseSchema = z.object({
  memberId: z.string(),
  actionType: z.string(),
});
export type Cause = z.infer<typeof CauseSchema>;

/* ─────────────────────────── client to server ─────────────────────────── */

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('action'), reqId: Id, rev: Rev, action: GameActionSchema }),
  z.object({ t: z.literal('setName'), name: Name }),
  z.object({ t: z.literal('lock'), locked: z.boolean() }),
  z.object({ t: z.literal('kick'), memberId: Id }),
  z.object({ t: z.literal('makeHost'), reqId: Id, memberId: Id }),
  z.object({ t: z.literal('allowBack'), reqId: Id, ref: Id }),
  z.object({ t: z.literal('roundOpen'), reqId: Id, winnerId: Id }),
  z.object({ t: z.literal('rackSubmit'), reqId: Id, seatId: Id, total: z.int().min(0).max(1000) }),
  z.object({ t: z.literal('roundCancel'), reqId: Id }),
  z.object({ t: z.literal('closeRoom'), reqId: Id }),
  z.object({ t: z.literal('leave'), reqId: Id }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/* ─────────────────────────── server to client ─────────────────────────── */

export const ServerMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('welcome'),
    protocol: z.int(),
    code: z.string(),
    game: GameSchema,
    you: z.object({
      memberId: z.string(),
      role: RoleSchema,
      seatId: z.string().nullable(),
      name: z.string(),
    }),
    rev: Rev,
    state: SnapshotSchema,
    room: RoomViewSchema,
  }),
  z.object({
    t: z.literal('state'),
    rev: Rev,
    state: SnapshotSchema,
    cause: CauseSchema.nullable(),
  }),
  z.object({ t: z.literal('room'), room: RoomViewSchema }),
  z.object({ t: z.literal('error'), reqId: z.string().nullable(), code: ErrorCodeSchema }),
  z.object({ t: z.literal('kicked') }),
  /** The host ended the room. Distinct from being removed, and said differently. */
  z.object({ t: z.literal('closed') }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/* ─────────────────────────── the join and create bodies ─────────────────────────── */

/**
 * The two HTTP requests, which are as untrusted as anything off a socket and
 * were the last thing here not saying so.
 *
 * The name cap is the one that matters. A name is kept on the member and
 * rebroadcast to every device on every presence change, so an unbounded one is
 * not a silly display name, it is a room nobody can play in.
 */
export const CreateRequestSchema = z.object({
  game: GameSchema,
  name: Name.default('Host'),
  device: z.string().max(256).optional(),
});
export type CreateRequest = z.infer<typeof CreateRequestSchema>;

export const JoinRequestSchema = z.object({
  name: Name,
  device: z.string().max(256).optional(),
  claim: Id.nullish(),
});
export type JoinRequest = z.infer<typeof JoinRequestSchema>;

/* ─────────────────────────── decoding ─────────────────────────── */

/**
 * A frame cap. Well under any real message, and it means a hostile client
 * cannot make the room parse megabytes before the shape is even looked at.
 */
export const MAX_FRAME_BYTES = 96 * 1024;

function decode<T>(schema: z.ZodType<T>, raw: string): T | null {
  if (raw.length > MAX_FRAME_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // not JSON at all
  }

  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** Returns the message, or null if it is anything other than one we understand. */
export const decodeClientMessage = (raw: string): ClientMessage | null =>
  decode(ClientMessageSchema, raw);

/**
 * The client decodes too. The server is not hostile, but a stale client meeting
 * a newer server is routine, and quietly ignoring a frame it cannot read beats
 * throwing inside a socket handler, which would drop the connection.
 */
export const decodeServerMessage = (raw: string): ServerMessage | null =>
  decode(ServerMessageSchema, raw);

export const encode = (message: ClientMessage | ServerMessage): string => JSON.stringify(message);

/* ─────────────────────────── player-facing copy ─────────────────────────── */

/**
 * Errors as a person would say them. No status codes, no networking words - the
 * same rule the dictionary lookup follows, for the same reason.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  'bad-message': 'Something went wrong. Try again.',
  'host-only': 'Only the host can do that.',
  'not-your-seat': 'You can only enter your own score.',
  'not-your-turn': 'It is not your turn yet.',
  'rate-limited': 'Slow down a moment, then try again.',
  'room-full': 'This room is full.',
  'room-locked': 'This room is not taking new players.',
  'kicked-out': 'The host removed you from this game.',
  'stale-rev': 'The game moved on. Have another look.',
  'too-large': 'This game is too big to share.',
  'unknown-action': 'This app is out of date. Refresh to get the latest.',
};

export const describeError = (code: ErrorCode): string => ERROR_MESSAGES[code];

/* ─────────────────────────── the end of a room ─────────────────────────── */

/**
 * Why a room will not have this device back.
 *
 * These ride on the socket's close code because that is the only channel there
 * is: a browser is never told why an upgrade failed, only that it did, and a
 * failure it cannot explain is indistinguishable from a tunnel. Without this a
 * client retries a room that ended hours ago, forever.
 *
 * 4000-4999 is the range reserved for the application.
 */
export const CLOSE = {
  /** The token is not one this room knows. */
  unauthorised: 4001,
  /** Closed by the host, or expired through disuse. Nothing to come back to. */
  ended: 4002,
  /** The host removed this member. */
  removed: 4003,
} as const;

export type GoneReason = keyof typeof CLOSE;

/** Terminal close codes, by number, for the client that has to read them. */
export const GONE_BY_CODE: Record<number, GoneReason> = Object.fromEntries(
  Object.entries(CLOSE).map(([reason, code]) => [code, reason as GoneReason]),
);

/**
 * Said as the person on the other end would hear it. They did not close
 * anything, so each of these explains what happened to the game they can see.
 */
export const GONE_MESSAGES: Record<GoneReason, string> = {
  ended: 'That room has ended. You are back to playing on your own.',
  removed: 'The host removed you from that room. You are back to playing on your own.',
  unauthorised: 'That room did not recognise this device. You are back to playing on your own.',
};
