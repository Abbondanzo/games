/**
 * The room wire protocol.
 *
 * Shared verbatim by the browser and the Worker, so it stays free of React,
 * the DOM and any Cloudflare type. Everything arriving over a socket is
 * untrusted, so decoding narrows through the guards in shared/parse rather
 * than asserting a shape onto whatever turned up.
 */
import {
  isArrayOf, isBoolean, isInteger, isOneOf, isRecord, isString, parseJson,
} from '../shared/parse';

/**
 * Bumped only for a breaking change. The client and the Worker deploy
 * independently, and a precached client can be weeks old, so additive changes
 * must stay backward compatible and leave this alone.
 */
export const PROTOCOL_VERSION = 1;

export const GAMES = ['scrabble', 'cricket', 'rummikub'] as const;
export type Game = (typeof GAMES)[number];
export const isGame = (v: unknown): v is Game => isOneOf(v, GAMES);

export const ROLES = ['host', 'player'] as const;
export type Role = (typeof ROLES)[number];

/** A game state, opaque here: only the game's own reducer gives it meaning. */
export type Snapshot = Record<string, unknown>;

/** A game action, likewise opaque. Its own reducer is the only thing that reads it. */
export type GameAction = { type: string } & Record<string, unknown>;

export const isGameAction = (v: unknown): v is GameAction => isRecord(v) && isString(v.type);

export interface Member {
  memberId: string;
  name: string;
  role: Role;
  seatId: string | null;
  online: boolean;
}

export interface RoomView {
  members: Member[];
  locked: boolean;
}

/** Everything that can go wrong, in a form the UI can turn into plain English. */
export const ERROR_CODES = [
  'bad-message',
  'host-only',
  'not-your-seat',
  'not-your-turn',
  'rate-limited',
  'room-full',
  'room-locked',
  'seat-taken',
  'stale-rev',
  'too-large',
  'unknown-action',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/* ─────────────────────────── client to server ─────────────────────────── */

export type ClientMessage =
  | { t: 'action'; reqId: string; rev: number; action: GameAction }
  | { t: 'claimSeat'; reqId: string; seatId: string | null }
  | { t: 'setName'; name: string }
  | { t: 'lock'; locked: boolean }
  | { t: 'kick'; memberId: string };

/* ─────────────────────────── server to client ─────────────────────────── */

export type ServerMessage
  = {
    t: 'welcome';
    protocol: number;
    code: string;
    game: Game;
    you: { memberId: string; role: Role; seatId: string | null; name: string };
    rev: number;
    state: Snapshot;
    room: RoomView;
  }
  | { t: 'state'; rev: number; state: Snapshot; cause: Cause | null }
  | { t: 'room'; room: RoomView }
  | { t: 'error'; reqId: string | null; code: ErrorCode }
  | { t: 'kicked' };

/** Who caused a state change, so the UI can say "Grace scored" rather than just redraw. */
export interface Cause {
  memberId: string;
  actionType: string;
}

/* ─────────────────────────── decoding ─────────────────────────── */

/**
 * A frame cap. Well under any real message, and it means a hostile client
 * cannot make the room allocate megabytes before the shape is even checked.
 */
export const MAX_FRAME_BYTES = 96 * 1024;

const isName = (v: unknown): v is string => isString(v) && v.length <= 24;
const isId = (v: unknown): v is string => isString(v) && v.length > 0 && v.length <= 64;

/** Returns the message, or null if it is anything other than one we understand. */
export function decodeClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_FRAME_BYTES) return null;

  const v = parseJson(raw);
  if (!isRecord(v)) return null;

  switch (v.t) {
    case 'action':
      return isId(v.reqId) && isInteger(v.rev) && v.rev >= 0 && isGameAction(v.action)
        ? { t: 'action', reqId: v.reqId, rev: v.rev, action: v.action }
        : null;

    case 'claimSeat':
      return isId(v.reqId) && (v.seatId === null || isId(v.seatId))
        ? { t: 'claimSeat', reqId: v.reqId, seatId: v.seatId }
        : null;

    case 'setName':
      return isName(v.name) ? { t: 'setName', name: v.name } : null;

    case 'lock':
      return isBoolean(v.locked) ? { t: 'lock', locked: v.locked } : null;

    case 'kick':
      return isId(v.memberId) ? { t: 'kick', memberId: v.memberId } : null;

    default:
      return null;
  }
}

const isMember = (v: unknown): v is Member =>
  isRecord(v)
  && isString(v.memberId)
  && isString(v.name)
  && isOneOf(v.role, ROLES)
  && (v.seatId === null || isString(v.seatId))
  && isBoolean(v.online);

const isRoomView = (v: unknown): v is RoomView =>
  isRecord(v) && isArrayOf(v.members, isMember) && isBoolean(v.locked);

const isCause = (v: unknown): v is Cause =>
  isRecord(v) && isString(v.memberId) && isString(v.actionType);

/**
 * The client decodes too. The server is not hostile, but a stale client meeting
 * a newer server is routine, and silently ignoring a frame it cannot read beats
 * throwing inside a socket handler.
 */
export function decodeServerMessage(raw: string): ServerMessage | null {
  if (raw.length > MAX_FRAME_BYTES) return null;

  const v = parseJson(raw);
  if (!isRecord(v)) return null;

  switch (v.t) {
    case 'welcome': {
      const you = v.you;
      if (!isInteger(v.protocol) || !isString(v.code) || !isGame(v.game)) return null;
      if (!isRecord(you) || !isString(you.memberId) || !isOneOf(you.role, ROLES)) return null;
      if (!(you.seatId === null || isString(you.seatId)) || !isString(you.name)) return null;
      if (!isInteger(v.rev) || !isRecord(v.state) || !isRoomView(v.room)) return null;
      return {
        t: 'welcome',
        protocol: v.protocol,
        code: v.code,
        game: v.game,
        you: { memberId: you.memberId, role: you.role, seatId: you.seatId, name: you.name },
        rev: v.rev,
        state: v.state,
        room: v.room,
      };
    }

    case 'state':
      return isInteger(v.rev) && isRecord(v.state) && (v.cause === null || isCause(v.cause))
        ? { t: 'state', rev: v.rev, state: v.state, cause: v.cause }
        : null;

    case 'room':
      return isRoomView(v.room) ? { t: 'room', room: v.room } : null;

    case 'error':
      return (v.reqId === null || isString(v.reqId)) && isOneOf(v.code, ERROR_CODES)
        ? { t: 'error', reqId: v.reqId, code: v.code }
        : null;

    case 'kicked':
      return { t: 'kicked' };

    default:
      return null;
  }
}

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
  'seat-taken': 'Someone else is already playing as them.',
  'stale-rev': 'The game moved on. Have another look.',
  'too-large': 'This game is too big to share.',
  'unknown-action': 'This app is out of date. Refresh to get the latest.',
};

/** Numbers are finite, so this is safe to render straight into the UI. */
export const describeError = (code: ErrorCode): string => ERROR_MESSAGES[code];
