/**
 * The word list validity is judged against, offline.
 *
 * Validity used to be whatever a third-party API said, which made every verdict
 * a network call and left the contested words - the two-letter ones - at the
 * mercy of a service that answers sporadically or, lately, not at all. The list
 * settles it locally instead, so a verdict is instant, the same every time, and
 * available at a table with no signal. The API is now only asked for the
 * definition, which is the part it is actually good at.
 *
 * It is ENABLE, the public-domain lexicon built for word games, rather than TWL
 * or SOWPODS, which are Hasbro's and Collins' to license. Two properties are
 * the reason it is this list and not a general English one:
 *
 * - **No proper nouns.** `mary`, `spain` and `london` are absent. The ordinary
 *   words that merely look like names are not: `japan` is a lacquer, `china` is
 *   porcelain, `john` is a toilet, `wales` is the plural of `wale`. Removing
 *   names by subtracting a list of names would have taken those with them.
 * - **Unexpurgated.** A list this replaced filtered out "bad words", which for
 *   a Scrabble scorer is not tidiness but wrong answers: it had `ball` and not
 *   `balls`, `damned` and not `damn`. A word list may leave out a word it has
 *   never heard of. It may not leave out one it disapproves of.
 *
 * A miss still means "probably not allowed" rather than a ruling. See
 * docs/scrabble.md, and `scripts/generate-words.mjs` for how it is built.
 */
export class WordListError extends Error {}

/**
 * Undoes the front-coding described in `scripts/generate-words.mjs`: each line
 * is the count of characters shared with the previous word, as a letter, then
 * the rest of the word.
 *
 * The header is checked rather than skipped. A deploy that has moved the files
 * answers a request for a missing asset with `index.html`, and HTML that
 * decoded quietly would mean every word on the board reading as invalid - so a
 * payload that is not this file, or is truncated, has to fail loudly instead.
 */
export function decodeWordList(text: string): Set<string> {
  const split = text.indexOf('\n');
  const [name, , claimed] = text.slice(0, Math.max(split, 0)).split(' ');
  if (name !== 'wordlist') throw new WordListError('That is not the word list.');

  const words = new Set<string>();
  let previous = '';
  for (const line of text.slice(split + 1).split('\n')) {
    if (!line) continue;
    const shared = line.charCodeAt(0) - 65;
    if (shared < 0 || shared > previous.length) {
      throw new WordListError('The word list is not readable.');
    }
    previous = previous.slice(0, shared) + line.slice(1);
    words.add(previous);
  }

  if (words.size !== Number(claimed)) {
    throw new WordListError(`The word list is incomplete: ${words.size} of ${claimed} words.`);
  }
  return words;
}

let words: Set<string> | null = null;
let pending: Promise<Set<string>> | null = null;

/**
 * Loaded once, on the first check rather than at startup: it is a megabyte of
 * text, and somebody scoring a game may never press Check at all. Its chunk is
 * precached with everything else, so that first load works with no connection.
 */
export function loadWordList(): Promise<Set<string>> {
  if (words) return Promise.resolve(words);
  pending ??= import('./words.txt?raw')
    .then((module) => {
      words = decodeWordList(module.default);
      return words;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Exposed for tests, which must not carry a loaded list between cases. */
export const forgetWordList = (): void => {
  words = null;
  pending = null;
};
