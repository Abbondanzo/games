/**
 * Creating, joining and looking up a room. Plain HTTP, so a bad code fails
 * before a socket is ever opened.
 */
import { z } from 'zod';
import { GameSchema, type Game } from '@shared/rooms/protocol';
import { ROOMS_URL } from './transport';
import type { StoredSession } from './storage';

const MembershipSchema = z.object({
  code: z.string(),
  token: z.string(),
  memberId: z.string(),
  game: GameSchema,
});

const PeekSchema = z.object({ game: GameSchema, open: z.boolean() });

export type RoomError =
  | 'no-room'
  | 'room-locked'
  | 'room-full'
  | 'rate-limited'
  | 'unreachable';

export type Result<T> = { ok: true; value: T } | { ok: false; error: RoomError };

/** Turns whatever went wrong into one of a handful of things we can explain. */
async function post(path: string, body: unknown): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetch(`${ROOMS_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }

  if (response.status === 404) return { ok: false, error: 'no-room' };
  if (response.status === 429) return { ok: false, error: 'rate-limited' };
  if (response.status === 409) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: detail?.error === 'room-full' ? 'room-full' : 'room-locked' };
  }
  if (!response.ok) return { ok: false, error: 'unreachable' };

  return { ok: true, value: await response.json().catch(() => null) };
}

const asSession = (value: unknown): Result<StoredSession> => {
  const parsed = MembershipSchema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: 'unreachable' };
};

export async function createRoom(game: Game, name: string): Promise<Result<StoredSession>> {
  const result = await post('/rooms', { game, name });
  return result.ok ? asSession(result.value) : result;
}

export async function joinRoom(code: string, name: string): Promise<Result<StoredSession>> {
  const result = await post(`/rooms/${code}/join`, { name });
  return result.ok ? asSession(result.value) : result;
}

/** Resolves which game a code belongs to, so a deep link knows where to go. */
export async function peekRoom(code: string): Promise<Result<{ game: Game; open: boolean }>> {
  let response: Response;
  try {
    response = await fetch(`${ROOMS_URL}/rooms/${code}`);
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  if (response.status === 404) return { ok: false, error: 'no-room' };
  if (!response.ok) return { ok: false, error: 'unreachable' };

  const parsed = PeekSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'unreachable' };
}

export const ROOM_ERRORS: Record<RoomError, string> = {
  'no-room': 'That code did not match a room.',
  'room-locked': 'This room is not taking new players.',
  'room-full': 'This room is full.',
  'rate-limited': 'Too many tries. Wait a minute, then try again.',
  unreachable: 'Could not reach the room. Check your connection.',
};
