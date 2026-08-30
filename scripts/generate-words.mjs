/**
 * Builds the offline word list the Scrabble tracker judges validity against.
 *
 *   pnpm words
 *
 * The output is committed, like the icons, so neither CI nor a deploy has to
 * fetch or process anything. This script is the only thing that reaches the
 * network, it is run by hand, and it refuses to write a list that fails its
 * own checks - see `assertUsable` at the bottom.
 *
 * The source is ENABLE, the public-domain lexicon built for word games. Two
 * properties matter and neither was true of what came before it:
 *
 *   - No proper nouns. `mary`, `spain` and `london` are absent, while the
 *     ordinary words that happen to look like names - `japan` the lacquer,
 *     `china` the porcelain, `john` the toilet, `wales` the ridges in fabric -
 *     are all still there. A filter built by subtracting a list of names would
 *     have taken those too.
 *   - Unexpurgated. An earlier source stripped "bad words", which for a
 *     Scrabble scorer is not tidiness but wrong answers: it had `ball` and not
 *     `balls`, `damned` and not `damn`.
 *
 * The list is front-coded: every line is the number of characters it shares
 * with the line before it (as a letter, A meaning none) followed by the rest of
 * the word. On a sorted list that removes most of the bytes - "abnegate,
 * abnegated, abnegates" becomes "Aabnegate, Iabnegated, Hs" - and it halves
 * what every visitor has to precache, before compression even starts.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/scrabble/lib/words.txt');

const SOURCE = 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';

/** Scrabble's board is 15 wide, and the entry box will not take more. */
const MAX_LENGTH = 15;

/**
 * The tournament two-letter words. ENABLE was compiled in 1997 and six of these
 * were added to the Scrabble dictionaries afterwards, `qi` and `za` among them
 * - which are exactly the ones arguments are about. They are listed in full
 * rather than as those six, so that the set is checked on every rebuild instead
 * of being a note about one that has drifted.
 */
const TWO_LETTER =
  `aa ab ad ae ag ah ai al am an ar as at aw ax ay ba be bi bo by da de do ed ef eh el em en er es
   et ex fa fe go ha he hi hm ho id if in is it jo ka ki la li lo ma me mi mm mo mu my na ne no nu
   od oe of oh oi om on op or os ow ox oy pa pe pi qi re sh si so ta ti to uh um un up us ut we wo
   xi xu ya ye yo za`.split(/\s+/);

/** Words that must survive, and names that must not, checked before writing. */
const MUST_INCLUDE = [...TWO_LETTER, 'balls', 'damn', 'crap', 'quizzes', 'boxes', 'japan', 'john'];
const MUST_EXCLUDE = ['mary', 'michael', 'james', 'sarah', 'spain', 'canada', 'london', 'france'];

const local = process.argv[2];
const source = local
  ? await readFile(local, 'utf8')
  : await fetch(SOURCE).then((response) => {
      if (!response.ok) throw new Error(`could not read the word list: ${response.status}`);
      return response.text();
    });

const words = new Set(
  source
    .split('\n')
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 2 && word.length <= MAX_LENGTH && /^[a-z]+$/.test(word)),
);
for (const word of TWO_LETTER) words.add(word);

assertUsable(words);

const sorted = [...words].sort();
const lines = [];
let previous = '';
for (const word of sorted) {
  let shared = 0;
  while (shared < previous.length && shared < word.length && previous[shared] === word[shared]) {
    shared++;
  }
  lines.push(String.fromCharCode(65 + shared) + word.slice(shared));
  previous = word;
}

// The header is the integrity check: a truncated or substituted file will not
// decode to the number of words it claims, and the reader refuses it. The
// middle field is provenance, and is the only record of which list this is.
const body = lines.join('\n');
await writeFile(OUT, `wordlist enable1 ${sorted.length}\n${body}\n`);

console.log(`${sorted.length} words -> ${OUT} (${(body.length / 1e6).toFixed(2)} MB front-coded)`);

/**
 * Refuse to write a list that is not the one we meant to build. This script
 * reaches the network, and a source that has moved, been rewritten or been
 * replaced by an error page must fail here rather than ship a board on which
 * every word reads as invalid.
 */
function assertUsable(list) {
  if (list.size < 150_000 || list.size > 200_000) {
    throw new Error(`that is not the word list: ${list.size} words`);
  }
  const absent = MUST_INCLUDE.filter((word) => !list.has(word));
  if (absent.length) throw new Error(`missing words that must be valid: ${absent.join(' ')}`);

  const present = MUST_EXCLUDE.filter((word) => list.has(word));
  if (present.length) throw new Error(`proper nouns that must not be valid: ${present.join(' ')}`);
}
