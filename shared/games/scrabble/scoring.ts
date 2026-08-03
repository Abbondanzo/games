import type { Draft, LetterMult, Tile, Turn, WordMult } from './types';

export const BINGO_BONUS = 50;

export const WORD_MULTS: readonly WordMult[] = [1, 2, 3, 4, 6, 9];

export const LETTER_VALUES: Readonly<Record<string, number>> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

/** Face value of a tile. Blanks are worth nothing regardless of the letter. */
export function tileValue(tile: Tile): number {
  return tile.blank ? 0 : (LETTER_VALUES[tile.ch] ?? 0);
}

/** Sum of letter values with their letter bonuses, then the word bonus. */
export function scoreTiles(tiles: readonly Tile[], wordMult: WordMult): number {
  const base = tiles.reduce((sum, t) => sum + tileValue(t) * t.lm, 0);
  return base * wordMult;
}

export const draftWord = (draft: Draft): string => draft.tiles.map((t) => t.ch).join('');

export const draftWordScore = (draft: Draft): number => scoreTiles(draft.tiles, draft.wordMult);

/** Everything banked this turn, plus the word still in the box, plus any bingo. */
export function turnTotal(draft: Draft): number {
  const banked = draft.words.reduce((sum, w) => sum + w.points, 0);
  return banked + draftWordScore(draft) + (draft.bingo ? BINGO_BONUS : 0);
}

export const sanitizeWord = (raw: string): string => raw.toUpperCase().replace(/[^A-Z]/g, '');

/**
 * Rebuild the tile list from typed text, carrying bonuses over to the letters
 * they were set on.
 *
 * Matching by position would be wrong: correcting CAT to CHAT would slide a
 * bonus set on the A onto the newly typed H. Aligning on the longest common
 * subsequence instead keeps each bonus with its letter through insertions and
 * deletions anywhere in the word.
 */
export function tilesFromWord(raw: string, previous: readonly Tile[]): Tile[] {
  const letters = sanitizeWord(raw).split('');
  const fresh = (ch: string): Tile => ({ ch, lm: 1 as LetterMult, blank: false });
  if (!previous.length) return letters.map(fresh);

  // lcs[i][j] = length of the longest common subsequence of previous[i..] and letters[j..].
  const lcs: number[][] = Array.from(
    { length: previous.length + 1 },
    () => new Array<number>(letters.length + 1).fill(0),
  );
  for (let i = previous.length - 1; i >= 0; i--) {
    for (let j = letters.length - 1; j >= 0; j--) {
      lcs[i]![j] = previous[i]!.ch === letters[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  // Walk the alignment, carrying the bonus wherever a letter is matched.
  const tiles: Tile[] = [];
  let i = 0;
  let j = 0;
  while (j < letters.length) {
    const ch = letters[j]!;
    if (i < previous.length && previous[i]!.ch === ch) {
      tiles.push({ ...previous[i]!, ch });
      i++;
      j++;
    } else if (i < previous.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      i++; // this old letter was deleted
    } else {
      tiles.push(fresh(ch)); // this letter is newly typed
      j++;
    }
  }
  return tiles;
}

/** Tap order for a tile: plain → double letter → triple letter → blank → plain. */
export function cycleTile(tile: Tile): Tile {
  if (tile.blank) return { ...tile, blank: false, lm: 1 };
  if (tile.lm === 1) return { ...tile, lm: 2 };
  if (tile.lm === 2) return { ...tile, lm: 3 };
  return { ...tile, lm: 1, blank: true };
}

export const emptyDraft = (): Draft => ({ tiles: [], wordMult: 1, bingo: false, words: [] });

export const scoreForPlayer = (turns: readonly Turn[], playerId: string): number =>
  turns.filter((t) => t.playerId === playerId).reduce((sum, t) => sum + t.points, 0);

export interface Standing {
  player: { id: string; name: string };
  score: number;
  words: number;
  average: number;
}

/** Players ranked high to low, with per-player word counts. */
export function standings(
  players: readonly { id: string; name: string }[],
  turns: readonly Turn[],
): Standing[] {
  return players
    .map((player) => {
      const score = scoreForPlayer(turns, player.id);
      const words = turns.filter((t) => t.playerId === player.id && t.kind === 'play').length;
      return { player, score, words, average: words ? Math.round(score / words) : 0 };
    })
    .sort((a, b) => b.score - a.score);
}
