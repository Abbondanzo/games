import { describe, expect, it } from 'vitest';
import {
  BOXES,
  CATEGORIES,
  faceOf,
  isOver,
  isValidScore,
  LOWER,
  roundNumber,
  scoreOptions,
  sheetFor,
  sheets,
  standings,
  UPPER,
  UPPER_BONUS,
  UPPER_TARGET,
  winners,
  YAHTZEE_BONUS,
  YAHTZEE_SCORE,
} from './rules';
import type { Bonus, Category, Player, Turn } from './types';

const ada: Player = { id: 'a', name: 'Ada' };
const grace: Player = { id: 'g', name: 'Grace' };
const two = [ada, grace];

let seq = 0;
const turn = (playerId: string, category: Category, value: number): Turn => ({
  id: `t${seq++}`,
  playerId,
  category,
  value,
});
const bonus = (playerId: string): Bonus => ({ id: `b${seq++}`, playerId });

/** A full sheet, so the finishing rules have something complete to read. */
const fullSheet = (playerId: string, value = 0): Turn[] =>
  CATEGORIES.map((c) => turn(playerId, c, isValidScore(c, value) ? value : 0));

describe('the shape of the sheet', () => {
  it('has thirteen boxes, six above the line and seven below', () => {
    expect(BOXES).toBe(13);
    expect(UPPER).toHaveLength(6);
    expect(LOWER).toHaveLength(7);
  });

  it('knows what face each upper box counts', () => {
    expect(UPPER.map(faceOf)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('what a box will take', () => {
  it('offers an upper box nothing but multiples of its own face', () => {
    expect(scoreOptions('ones')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(scoreOptions('sixes')).toEqual([0, 6, 12, 18, 24, 30]);
  });

  it('offers a fixed combination its one number, or nothing', () => {
    expect(scoreOptions('fullHouse')).toEqual([0, 25]);
    expect(scoreOptions('smallStraight')).toEqual([0, 30]);
    expect(scoreOptions('largeStraight')).toEqual([0, 40]);
    expect(scoreOptions('yahtzee')).toEqual([0, YAHTZEE_SCORE]);
  });

  it('offers every sum five dice can make where the whole hand counts', () => {
    for (const category of ['threeOfAKind', 'fourOfAKind', 'chance'] as const) {
      const options = scoreOptions(category);
      expect(options[0]).toBe(0);
      expect(options[1]).toBe(5);
      expect(options.at(-1)).toBe(30);
      expect(options).toHaveLength(27);
    }
  });

  it('always leads with a scratch, because a turn can score nothing', () => {
    for (const category of CATEGORIES) expect(scoreOptions(category)[0]).toBe(0);
  });

  it.each([
    ['fives', 15, true],
    ['fives', 30, false], // six fives is more dice than there are
    ['twos', 7, false], // no count of twos makes an odd number
    ['chance', 30, true],
    ['chance', 4, false], // five dice cannot add to less than five
    ['chance', 31, false],
    ['fullHouse', 25, true],
    ['fullHouse', 30, false],
    ['yahtzee', 50, true],
    ['ones', 2.5, false],
    ['ones', -1, false],
  ] as [Category, number, boolean][])('says %s can hold %d: %s', (category, value, ok) => {
    expect(isValidScore(category, value)).toBe(ok);
  });
});

describe('adding a sheet up', () => {
  it('totals the upper section on its own', () => {
    const turns = [turn('a', 'ones', 3), turn('a', 'fives', 15)];
    expect(sheetFor(turns, [], 'a').upper).toBe(18);
  });

  it('pays the bonus at the target and not a point below it', () => {
    const just = [turn('a', 'sixes', 30), turn('a', 'fives', 25), turn('a', 'fours', 8)];
    expect(sheetFor(just, [], 'a').upper).toBe(UPPER_TARGET);
    expect(sheetFor(just, [], 'a').upperBonus).toBe(UPPER_BONUS);

    const short = [turn('a', 'sixes', 30), turn('a', 'fives', 25), turn('a', 'fours', 4)];
    expect(sheetFor(short, [], 'a').upperBonus).toBe(0);
    expect(sheetFor(short, [], 'a').toTarget).toBe(4);
  });

  it('adds the lower section and the bonus into one total', () => {
    const turns = [
      turn('a', 'sixes', 30),
      turn('a', 'fives', 25),
      turn('a', 'fours', 8),
      turn('a', 'fullHouse', 25),
      turn('a', 'largeStraight', 40),
    ];
    const sheet = sheetFor(turns, [], 'a');
    expect(sheet.lower).toBe(65);
    expect(sheet.total).toBe(63 + 35 + 65);
  });

  it('keeps a scratched box as a filled zero rather than an empty one', () => {
    const sheet = sheetFor([turn('a', 'yahtzee', 0)], [], 'a');
    expect(sheet.scores.yahtzee).toBe(0);
    expect(sheet.filled).toBe(1);
    expect(sheet.remaining).toBe(BOXES - 1);
  });

  it('reads only the sheet it was asked for', () => {
    const turns = [turn('a', 'chance', 20), turn('g', 'chance', 8)];
    expect(sheetFor(turns, [], 'a').total).toBe(20);
    expect(sheetFor(turns, [], 'g').total).toBe(8);
  });
});

describe('extra Yahtzees', () => {
  const rolled = [turn('a', 'yahtzee', YAHTZEE_SCORE)];

  it('pays 100 apiece once the box itself is worth 50', () => {
    const sheet = sheetFor(rolled, [bonus('a'), bonus('a')], 'a');
    expect(sheet.extraYahtzees).toBe(2);
    expect(sheet.bonusPoints).toBe(2 * YAHTZEE_BONUS);
    expect(sheet.total).toBe(YAHTZEE_SCORE + 200);
  });

  /**
   * Regression: the bonus used to be counted from the claims alone, so
   * correcting the Yahtzee box back to a scratch left the 100s behind on a
   * sheet that no longer said a Yahtzee had been rolled at all.
   */
  it('stops counting once the Yahtzee box is scratched', () => {
    const scratched = [turn('a', 'yahtzee', 0)];
    const sheet = sheetFor(scratched, [bonus('a'), bonus('a')], 'a');
    expect(sheet.extraYahtzees).toBe(0);
    expect(sheet.bonusPoints).toBe(0);
    expect(sheet.canClaimBonus).toBe(false);
  });

  it('pays nothing while the box is still empty', () => {
    expect(sheetFor([], [bonus('a')], 'a').bonusPoints).toBe(0);
  });

  it('does not spill onto another player', () => {
    const turns = [...rolled, turn('g', 'yahtzee', YAHTZEE_SCORE)];
    expect(sheetFor(turns, [bonus('a')], 'g').extraYahtzees).toBe(0);
  });
});

describe('standings', () => {
  it('puts the highest total first', () => {
    const turns = [turn('a', 'chance', 12), turn('g', 'chance', 25)];
    expect(standings(two, turns, []).map((s) => s.player.name)).toEqual(['Grace', 'Ada']);
  });

  it('breaks a tie in favour of the sheet with fewer boxes left', () => {
    const turns = [
      ...fullSheet('g'),
      turn('a', 'chance', 0), // level on nothing, but still playing
    ];
    expect(standings(two, turns, []).map((s) => s.player.name)).toEqual(['Grace', 'Ada']);
  });

  it('gives every player a row, even one who has not scored', () => {
    expect(sheets(two, [], [])).toEqual({
      a: expect.objectContaining({ total: 0, remaining: BOXES }),
      g: expect.objectContaining({ total: 0, remaining: BOXES }),
    });
  });
});

describe('finishing', () => {
  it('is not over while anybody has a box left', () => {
    const turns = [...fullSheet('a'), turn('g', 'chance', 10)];
    expect(isOver(two, turns, [])).toBe(false);
    expect(winners(two, turns, [])).toEqual([]);
  });

  it('is over once every sheet is full', () => {
    const turns = [...fullSheet('a'), ...fullSheet('g')];
    expect(isOver(two, turns, [])).toBe(true);
  });

  it('is not over before anybody has played', () => {
    expect(isOver(two, [], [])).toBe(false);
    expect(isOver([], [], [])).toBe(false);
  });

  it('names the winner on the highest total', () => {
    const turns = [...fullSheet('a', 30), ...fullSheet('g')];
    expect(winners(two, turns, []).map((p) => p.name)).toEqual(['Ada']);
  });

  it('names everybody when they tie', () => {
    const turns = [...fullSheet('a'), ...fullSheet('g')];
    expect(winners(two, turns, []).map((p) => p.name)).toEqual(['Ada', 'Grace']);
  });
});

describe('which round the table is on', () => {
  it('starts at one and waits for everybody before moving on', () => {
    expect(roundNumber(two, [], [])).toBe(1);
    expect(roundNumber(two, [turn('a', 'ones', 3)], [])).toBe(1);
    expect(roundNumber(two, [turn('a', 'ones', 3), turn('g', 'ones', 2)], [])).toBe(2);
  });

  it('stops at the last round rather than counting a fourteenth', () => {
    const turns = [...fullSheet('a'), ...fullSheet('g')];
    expect(roundNumber(two, turns, [])).toBe(BOXES);
  });

  it('has a round to be on before anybody has joined', () => {
    expect(roundNumber([], [], [])).toBe(1);
  });
});
