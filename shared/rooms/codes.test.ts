import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, CODE_SPACE, isCode, mintCode, normaliseCode } from './codes';

describe('the alphabet', () => {
  it('excludes both halves of every confusable pair', () => {
    for (const ch of '01ILO') expect(CODE_ALPHABET).not.toContain(ch);
  });

  it('is 31 symbols giving 923,521 codes', () => {
    expect(CODE_ALPHABET.length).toBe(31);
    expect(new Set(CODE_ALPHABET).size).toBe(31); // no duplicates
    expect(CODE_SPACE).toBe(923_521);
  });
});

describe('mintCode', () => {
  it('returns four characters from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = mintCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect([...code].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it('always produces something normaliseCode accepts', () => {
    for (let i = 0; i < 100; i++) expect(isCode(mintCode())).toBe(true);
  });

  // A plain byte % 31 would favour the first ten symbols, since 256 is not a
  // multiple of 31. Bytes at or above the limit must be discarded, not folded.
  it('discards biasing bytes rather than folding them', () => {
    const bytes = [255, 254, 0, 1, 2, 3];
    let i = 0;
    const code = mintCode((n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]!));
    expect(code).toBe('2345'); // 255 and 254 skipped, then 0,1,2,3
  });

  it('keeps drawing until it has a full code', () => {
    // A source that yields nothing usable at first must not return a short code.
    let call = 0;
    const code = mintCode((n) => {
      call += 1;
      return Uint8Array.from({ length: n }, () => (call === 1 ? 255 : 5));
    });
    expect(code).toHaveLength(CODE_LENGTH);
  });

  it('spreads across the alphabet', () => {
    const seen = new Set([...Array(400)].flatMap(() => [...mintCode()]));
    expect(seen.size).toBeGreaterThan(25); // not stuck on a few symbols
  });
});

describe('normaliseCode', () => {
  it.each([
    ['abcd', 'ABCD'],
    ['AB CD', 'ABCD'],
    ['ab-cd', 'ABCD'],
    ['  9xyz  ', '9XYZ'],
  ])('cleans %o into %o', (input, expected) => {
    expect(normaliseCode(input)).toBe(expected);
  });

  // Both halves of each pair are absent, so there is nothing to correct these
  // to. Guessing could send someone into a stranger's room.
  it.each(['0BCD', 'OBCD', '1BCD', 'IBCD', 'LBCD'])(
    'rejects the confusable %o rather than guessing',
    (input) => {
      expect(normaliseCode(input)).toBeNull();
    },
  );

  it.each([
    ['ABC', 'too short'],
    ['ABCDE', 'too long'],
    ['', 'empty'],
    ['AB!D', 'punctuation'],
  ])('rejects %o (%s)', (input) => {
    expect(normaliseCode(input)).toBeNull();
  });
});
