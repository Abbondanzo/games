/**
 * Room codes.
 *
 * Four characters, read aloud across a table and typed on a phone, so the
 * alphabet drops both halves of every confusable pair: 0 and O are out, and so
 * are 1, I and L. 31 symbols to the power of 4 is 923,521 codes, which is
 * enough that guessing is not the easy way in.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const CODE_LENGTH = 4;

/** Total codes: 923,521. Exported so tests can assert the space did not shrink. */
export const CODE_SPACE = CODE_ALPHABET.length ** CODE_LENGTH;

export type RandomBytes = (length: number) => Uint8Array;

const cryptoBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/**
 * Rejection sampling rather than a plain modulo: 256 is not a multiple of 31,
 * so `byte % 31` would make the first ten symbols slightly likelier. It costs a
 * loop and buys a flat distribution.
 */
export function mintCode(random: RandomBytes = cryptoBytes): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let code = '';

  while (code.length < CODE_LENGTH) {
    for (const byte of random(CODE_LENGTH)) {
      if (byte >= limit) continue; // would bias the result, so draw again
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * Cleans up what someone typed, or returns null if it cannot be a code.
 *
 * Spaces and dashes are dropped, because people space codes out when reading
 * them aloud. Confusable characters are rejected rather than corrected: both
 * halves of each pair are missing from the alphabet, so a typed 0, O, 1, I or L
 * has no single thing it could have meant. Better to say "check the code" than
 * to guess and send someone to a stranger's room.
 */
export function normaliseCode(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
  if (cleaned.length !== CODE_LENGTH) return null;
  if (![...cleaned].every((ch) => CODE_ALPHABET.includes(ch))) return null;
  return cleaned;
}

export const isCode = (value: string): boolean => normaliseCode(value) === value;
