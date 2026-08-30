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
  return `wordlist source@1.0.0 ${words.length}\n${lines.join('\n')}\n`;
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
    expect(() => decodeWordList('wordlist source@1 1\nAab\nZc')).toThrow(WordListError);
  });
});

describe('loadWordList', () => {
  it('has the two-letter words Scrabble arguments are about', async () => {
    const words = await loadWordList();
    for (const word of ['ax', 'za', 'jo', 'xu', 'qi', 'aa', 'oe']) {
      expect(words.has(word)).toBe(true);
    }
  });

  // Regression: ENABLE was compiled in 1997 and six tournament two-letter words
  // were added to the Scrabble dictionaries after it - `qi` and `za` among
  // them, which are precisely the ones players argue about. The generator adds
  // the canonical set back, and this is what holds it there.
  it('has the two-letter words its source predates', async () => {
    const words = await loadWordList();
    for (const word of ['da', 'fe', 'ki', 'oi', 'qi', 'za']) {
      expect(words.has(word)).toBe(true);
    }
  });

  // Regression: the list was a general English one and marked names valid.
  it('does not treat names and places as words', async () => {
    const words = await loadWordList();
    for (const name of [
      'mary',
      'michael',
      'james',
      'william',
      'sarah',
      'spain',
      'canada',
      'london',
      'france',
      'vienna',
      'virginia',
      'greece',
    ]) {
      expect(words.has(name)).toBe(false);
    }
  });

  // The other half of that, and the reason a list of names could not just be
  // subtracted: these look like names and are ordinary words.
  it('keeps the ordinary words that happen to look like names', async () => {
    const words = await loadWordList();
    for (const word of ['japan', 'china', 'john', 'wales', 'lima', 'rose', 'grace', 'will']) {
      expect(words.has(word)).toBe(true);
    }
  });

  it('has no single letters and nothing over the board width', async () => {
    const words = await loadWordList();
    expect(words.has('a')).toBe(false);
    expect([...words].every((word) => word.length >= 2 && word.length <= 15)).toBe(true);
  });

  // Regression: the list was built from a source that filters out "bad words",
  // which for a Scrabble scorer is not tidiness but wrong answers - `balls` was
  // absent while `ball` was present, and the board read it as "not a word". The
  // filtering was not even consistent: `damned` stayed while `damn` went.
  it('has the words its predecessor censored, which are legal plays', async () => {
    const words = await loadWordList();
    for (const word of ['balls', 'damn', 'hell', 'crap', 'bum', 'turd', 'ass', 'arse']) {
      expect(words.has(word)).toBe(true);
    }
  });

  // The same word list has to answer for a word and its plural. This is the
  // shape the bug was reported in, whatever its actual cause turned out to be.
  it('has plurals wherever it has the singular', async () => {
    const words = await loadWordList();
    for (const [singular, plural] of [
      ['ball', 'balls'],
      ['cat', 'cats'],
      ['box', 'boxes'],
      ['quiz', 'quizzes'],
      ['tile', 'tiles'],
    ]) {
      expect(words.has(singular!)).toBe(true);
      expect(words.has(plural!)).toBe(true);
    }
  });

  it('decodes once and hands the same set back', async () => {
    const first = await loadWordList();
    expect(await loadWordList()).toBe(first);
    expect(first.size).toBeGreaterThan(150_000);
  });
});
