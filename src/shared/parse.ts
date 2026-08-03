/**
 * Narrowing helpers for untrusted input: stored games, and room messages off
 * the wire.
 *
 * The point is to get from `unknown` to a real type by *checking*, never by
 * asserting. `JSON.parse(raw) as GameState` compiles and tells you nothing;
 * these compose into guards that actually establish what they claim, so the
 * only `unknown` left is the one value that genuinely is unknown - the parsed
 * JSON at the moment it arrives.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isString = (v: unknown): v is string => typeof v === 'string';

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/** Finite only: NaN and Infinity survive JSON round trips as nulls or errors. */
export const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export const isInteger = (v: unknown): v is number => Number.isInteger(v);

export const isArrayOf = <T>(v: unknown, item: (x: unknown) => x is T): v is T[] =>
  Array.isArray(v) && v.every(item);

/** One of a fixed set of literals, keeping the literal type. */
export const isOneOf = <const T extends readonly unknown[]>(
  v: unknown,
  options: T,
): v is T[number] => options.includes(v);

/** A record whose values all pass `item`. Keys are always strings from JSON. */
export const isRecordOf = <T>(
  v: unknown,
  item: (x: unknown) => x is T,
): v is Record<string, T> => isRecord(v) && Object.values(v).every(item);

/** Parses JSON without lying about what came back. */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
