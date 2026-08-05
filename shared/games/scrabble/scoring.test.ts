import { describe, expect, it } from 'vitest';
import {
  BINGO_BONUS,
  LETTER_VALUES,
  cycleTile,
  scoreTiles,
  standings,
  tilesFromWord,
  turnTotal,
} from './scoring';
import type { LetterMult, Tile, Turn, WordMult } from './types';

const tiles = (
  word: string,
  mods: Record<number, { lm?: LetterMult; blank?: boolean }> = {},
): Tile[] =>
  [...word].map((ch, i) => ({ ch, lm: mods[i]?.lm ?? 1, blank: mods[i]?.blank ?? false }));

describe('letter values', () => {
  it('matches the standard English tile distribution', () => {
    expect(Object.values(LETTER_VALUES).reduce((a, b) => a + b, 0)).toBe(87);
    expect(LETTER_VALUES.Q).toBe(10);
    expect(LETTER_VALUES.K).toBe(5);
  });
});

describe('scoreTiles', () => {
  const cases: [string, number, number][] = [
    ['QUIZ, no bonuses', scoreTiles(tiles('QUIZ'), 1), 22],
    ['CAT on a double word', scoreTiles(tiles('CAT'), 2), 10],
    [
      'ZEBRA with Z on a triple letter, double word',
      scoreTiles(tiles('ZEBRA', { 0: { lm: 3 } }), 2),
      72,
    ],
    [
      'JAZZY, J on double letter, two double words',
      scoreTiles(tiles('JAZZY', { 0: { lm: 2 } }), 4),
      164,
    ],
  ];

  it.each(cases)('%s = %i', (_name, got, want) => {
    expect(got).toBe(want);
  });

  it('scores a blank as zero', () => {
    expect(scoreTiles(tiles('HELLO', { 2: { blank: true } }), 1)).toBe(7);
  });

  it('still applies the word multiplier to a play containing a blank', () => {
    // AB with a blank B: (1 + 0) × 2 = 2. The blank contributes nothing but
    // does not stop the word bonus applying.
    expect(scoreTiles(tiles('AB', { 1: { blank: true } }), 2)).toBe(2);
  });

  it('ignores a letter multiplier sitting under a blank', () => {
    expect(scoreTiles(tiles('AB', { 1: { blank: true, lm: 3 } }), 1)).toBe(1);
  });
});

describe('turnTotal', () => {
  it('adds banked words, the word in progress, and the bingo bonus', () => {
    const total = turnTotal({
      tiles: tiles('CAT'),
      wordMult: 2 as WordMult,
      bingo: true,
      words: [{ word: 'QUIZ', points: 22 }],
    });
    expect(total).toBe(22 + 10 + BINGO_BONUS);
  });
});

describe('tilesFromWord', () => {
  it('strips anything that is not a letter and uppercases', () => {
    expect(tilesFromWord('c4t!', []).map((t) => t.ch)).toEqual(['C', 'T']);
  });

  // Position matching would slide the bonus onto whichever letter now sits at
  // that index, quietly changing the score.
  it('keeps a bonus with its letter when one is inserted before it', () => {
    const cat = tilesFromWord('CAT', []);
    cat[1]!.lm = 2; // double letter on the A
    expect(scoreTiles(cat, 1)).toBe(6);

    const chat = tilesFromWord('CHAT', cat);
    expect(chat.map((t) => `${t.ch}${t.lm}`)).toEqual(['C1', 'H1', 'A2', 'T1']);
    expect(scoreTiles(chat, 1)).toBe(10);
  });

  it('keeps a bonus with its letter when one is deleted before it', () => {
    const quiz = tilesFromWord('QUIZ', []);
    quiz[3]!.lm = 3; // triple letter on the Z
    const uiz = tilesFromWord('UIZ', quiz);
    expect(uiz.map((t) => `${t.ch}${t.lm}`)).toEqual(['U1', 'I1', 'Z3']);
    expect(scoreTiles(uiz, 1)).toBe(1 + 1 + 30);
  });

  it('carries a blank through an insertion', () => {
    const cat = tilesFromWord('CAT', []);
    cat[0]!.blank = true;
    const chat = tilesFromWord('CHAT', cat);
    expect(chat[0]).toMatchObject({ ch: 'C', blank: true });
    expect(chat[1]).toMatchObject({ ch: 'H', blank: false });
  });

  it('starts clean when the word is replaced outright', () => {
    const quiz = tilesFromWord('QUIZ', []);
    quiz[0]!.lm = 3;
    expect(tilesFromWord('BOX', quiz).every((t) => t.lm === 1 && !t.blank)).toBe(true);
  });

  it('keeps a bonus already set at a position when more letters are typed', () => {
    const first = tilesFromWord('QUIZ', []);
    first[0]!.lm = 3;
    const grown = tilesFromWord('QUIZZ', first);
    expect(grown[0]!.lm).toBe(3);
    expect(grown).toHaveLength(5);
  });
});

describe('cycleTile', () => {
  it('cycles plain → double → triple → blank → plain', () => {
    let tile: Tile = { ch: 'Q', lm: 1, blank: false };
    tile = cycleTile(tile);
    expect(tile).toMatchObject({ lm: 2, blank: false });
    tile = cycleTile(tile);
    expect(tile).toMatchObject({ lm: 3, blank: false });
    tile = cycleTile(tile);
    expect(tile).toMatchObject({ lm: 1, blank: true });
    tile = cycleTile(tile);
    expect(tile).toMatchObject({ lm: 1, blank: false });
  });
});

describe('standings', () => {
  const players = [
    { id: 'a', name: 'Ada' },
    { id: 'b', name: 'Grace' },
  ];
  const turn = (playerId: string, points: number, kind: Turn['kind'] = 'play'): Turn => ({
    id: `${playerId}-${points}`,
    playerId,
    kind,
    words: ['X'],
    bingo: false,
    points,
  });

  it('ranks by score and averages only over scoring plays', () => {
    const rows = standings(players, [turn('a', 10), turn('a', 20), turn('b', 40)]);
    expect(rows.map((r) => [r.player.name, r.score, r.words, r.average])).toEqual([
      ['Grace', 40, 1, 40],
      ['Ada', 30, 2, 15],
    ]);
  });

  it('counts adjustments in the score but not as words played', () => {
    const rows = standings(players, [turn('a', 30), turn('a', -8, 'adjust')]);
    expect(rows[0]).toMatchObject({ score: 22, words: 1 });
  });
});
