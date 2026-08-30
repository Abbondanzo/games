import { afterEach, describe, expect, it } from 'vitest';
import { WordListError, decodeWordList, forgetWordList, loadWordList } from './words';

afterEach(forgetWordList);

/** The shape the generator writes: a header, then front-coded lines. */
const encoded = (words: string[]) => {
  const lines = [];
  let previous = '';
  for (const word of words) {
    let shared = 0;
    while (shared < previous.length && previous[shared] === word[shared]) shared++;
    lines.push(String.fromCharCode(65 + shared) + word.slice(shared));
    previous = word;
  }
  return `word-list 4.1.0 ${words.length}\n${lines.join('\n')}\n`;
};

describe('decodeWordList', () => {
  it('rebuilds words from their shared prefixes', () => {
    const words = decodeWordList(encoded(['abnegate', 'abnegated', 'abnegates', 'zebra']));
    expect([...words]).toEqual(['abnegate', 'abnegated', 'abnegates', 'zebra']);
  });

  // Regression: a deploy that has moved the files answers a request for a
  // missing asset with index.html. HTML decoding quietly would mean every word
  // on the board reading as invalid, which is the worst possible way to fail.
  it('refuses a payload that is not the word list', () => {
    expect(() => decodeWordList('<!doctype html>\n<html></html>')).toThrow(WordListError);
  });

  it('refuses a list that is missing words it claims to have', () => {
    const truncated = encoded(['alpha', 'beta', 'gamma']).replace('\nAgamma', '');
    expect(() => decodeWordList(truncated)).toThrow(/incomplete/);
  });

  it('refuses a line sharing more characters than the word before it has', () => {
    expect(() => decodeWordList('word-list 1 1\nAab\nZc')).toThrow(WordListError);
  });
});

describe('loadWordList', () => {
  it('has the two-letter words Scrabble arguments are about', async () => {
    const words = await loadWordList();
    for (const word of ['ax', 'za', 'jo', 'xu', 'qi', 'aa', 'oe']) {
      expect(words.has(word)).toBe(true);
    }
  });

  it('has no proper nouns, no single letters and nothing over the board width', async () => {
    const words = await loadWordList();
    expect(words.has('london')).toBe(false);
    expect(words.has('a')).toBe(false);
    expect([...words].every((word) => word.length >= 2 && word.length <= 15)).toBe(true);
  });

  it('decodes once and hands the same set back', async () => {
    const first = await loadWordList();
    expect(await loadWordList()).toBe(first);
    expect(first.size).toBeGreaterThan(250_000);
  });
});
