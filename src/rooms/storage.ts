/**
 * The bit of a room this device remembers: enough to reconnect, and nothing
 * that identifies anyone else.
 */
import { z } from 'zod';
import type { Game } from '@shared/rooms/protocol';
import { GameSchema } from '@shared/rooms/protocol';

const SessionSchema = z.object({
  game: GameSchema,
  code: z.string(),
  token: z.string(),
  memberId: z.string(),
});

export type StoredSession = z.infer<typeof SessionSchema>;

/**
 * Per game, and separate from the solo save, so joining a room never overwrites
 * the game someone was already keeping on their own device.
 */
const key = (game: Game) => `games.room.${game}.v1`;

export function readSession(game: Game): StoredSession | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(game));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = SessionSchema.safeParse(parsed);
  return result.success && result.data.game === game ? result.data : null;
}

export function writeSession(session: StoredSession): void {
  try {
    localStorage.setItem(key(session.game), JSON.stringify(session));
  } catch {
    // Storage can be unavailable; the room still works for this tab.
  }
}

export function clearSession(game: Game): void {
  try {
    localStorage.removeItem(key(game));
  } catch {
    // Nothing to do.
  }
}

/** The name this device last played under, offered as the default next time. */
const NAME_KEY = 'games.name.v1';

export function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.slice(0, 24) ?? '';
  } catch {
    return '';
  }
}

export function writeName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 24));
  } catch {
    // Storage can be unavailable; they will just type it again.
  }
}
