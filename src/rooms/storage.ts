/**
 * The bit of a room this device remembers: enough to reconnect, and nothing
 * that identifies anyone else.
 */
import { z } from 'zod';
import type { Game } from '@shared/rooms/protocol';
import { GameSchema } from '@shared/rooms/protocol';
import { readJson, removeKey, writeJson } from '../shared/localStore';

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
  const stored = readJson(key(game), SessionSchema);
  // A session filed under one game naming another is not one to act on.
  return stored?.game === game ? stored : null;
}

export const writeSession = (session: StoredSession): void =>
  writeJson(key(session.game), session);

export const clearSession = (game: Game): void => removeKey(key(game));

/** The name this device last played under, offered as the default next time. */
const NAME_KEY = 'games.name.v1';

/** A bare string rather than JSON, from before any of this was structured. */
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
