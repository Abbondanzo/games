/**
 * Builds the offline word list the Scrabble tracker judges validity against.
 *
 *   pnpm words
 *
 * The output is committed, like the icons, so neither CI nor a deploy has to
 * fetch or process anything. Rerun this only to take a new upstream release.
 *
 * The list is front-coded: every line is the number of characters it shares
 * with the line before it (as a letter, A meaning none) followed by the rest of
 * the word. On a sorted list that removes most of the bytes - "abnegate,
 * abnegated, abnegates" becomes "Aabnegate, Iabnegated, Hs" - and it halves
 * what every visitor has to precache, before compression even starts.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/scrabble/lib/words.txt');

/** Scrabble's board is 15 wide, and the entry box will not take more. */
const MAX_LENGTH = 15;

// The package's entry point exports the path to the list rather than the list,
// and it exports neither the text file nor its manifest, so both are read from
// the directory the entry point resolves to.
const packageDir = dirname(require.resolve('word-list'));
const source = await readFile(join(packageDir, 'words.txt'), 'utf8');
const { version } = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));

const words = [
  ...new Set(
    source
      .split('\n')
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length >= 2 && word.length <= MAX_LENGTH && /^[a-z]+$/.test(word)),
  ),
].sort();

const lines = [];
let previous = '';
for (const word of words) {
  let shared = 0;
  while (shared < previous.length && shared < word.length && previous[shared] === word[shared]) {
    shared++;
  }
  lines.push(String.fromCharCode(65 + shared) + word.slice(shared));
  previous = word;
}

// The header is the integrity check: a truncated or substituted file will not
// decode to the number of words it claims, and the reader refuses it.
const body = lines.join('\n');
await writeFile(OUT, `word-list ${version} ${words.length}\n${body}\n`);

console.log(`${words.length} words -> ${OUT} (${(body.length / 1e6).toFixed(2)} MB front-coded)`);
