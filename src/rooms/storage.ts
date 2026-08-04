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

/**
 * A secret this device holds for one room.
 *
 * It is how the room recognises somebody coming back after they leave, and it
 * exists because a name cannot do that job: names are visible, typeable by
 * anyone, changeable by their owner, and two people can want the same one.
 *
 * Rules it lives by:
 * - Never shown, never editable, and never sent over the socket. It goes in the
 *   body of the join request, over HTTPS, and nowhere else.
 * - One per room code, so nothing links a device across two rooms.
 * - It outlives the session, which is cleared on the way out. That is the whole
 *   point: leaving is what it is for.
 */
const DeviceSchema = z.object({ code: z.string(), secret: z.string() });

const deviceKey = (game: Game) => `games.room.${game}.device.v1`;

const mintSecret = (): string => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
};

/**
 * The secret for this room, minting one the first time. Stable across leaving
 * and coming back; a different room gets a different secret.
 */
export function deviceFor(game: Game, code: string): string {
  const stored = readJson(deviceKey(game), DeviceSchema);
  if (stored?.code === code) return stored.secret;

  const secret = mintSecret();
  writeJson(deviceKey(game), { code, secret });
  return secret;
}

/**
 * Hosting has to mint the secret before the room exists, since the code comes
 * back with it. Keep it once the code is known.
 */
export const newDevice = (): string => mintSecret();

export const rememberDevice = (game: Game, code: string, secret: string): void =>
  writeJson(deviceKey(game), { code, secret });

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
