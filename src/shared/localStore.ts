/**
 * Reading and writing this device's own saves.
 *
 * `localStorage` throws rather than returning null when a browser has it turned
 * off, which private browsing does, so every access has to be guarded. That was
 * written out eight times before this file existed - and the ninth caller is
 * the one that forgets, because nothing in a normal test run ever throws.
 *
 * Nothing here is shared with the Worker: it is browser-only by definition, so
 * it lives under `src/` rather than in `shared/`.
 */
import type { z } from 'zod';

/**
 * A saved value, or null if there is not one that makes sense. A save is as
 * untrusted as anything else - it can be hand-edited, or left by an older
 * version of the app - so it goes through the same zod parse everything does.
 */
export function readJson<T>(key: string, schema: z.ZodType<T>): T | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
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

  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** Best effort. Storage being unavailable is not worth failing a game over. */
export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: the game keeps working, it just will not be here later.
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // As above.
  }
}

/**
 * Entries whose owner is still on the roster, dropped one at a time.
 *
 * A game is worth more than the worst row in it: one malformed turn should cost
 * that turn, not the whole save. The owner check matters because a player can
 * be removed, and a turn belonging to nobody would break every replay that
 * looks their name up.
 */
export function keepValid<E>(
  raw: readonly unknown[],
  schema: z.ZodType<E>,
  ownerOf: (entry: E) => string,
  ids: ReadonlySet<string>,
): E[] {
  const kept: E[] = [];
  for (const entry of raw) {
    const result = schema.safeParse(entry);
    if (result.success && ids.has(ownerOf(result.data))) kept.push(result.data);
  }
  return kept;
}

/** A turn pointer that survived a roster shrinking under it. */
export const clampIndex = (index: number, length: number): number =>
  (index < length ? index : 0);
