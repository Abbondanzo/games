/**
 * What a Yahtzee sheet is worth, worked out from the boxes people filled in.
 *
 * Nothing here knows about React or storage: the room server replays the same
 * functions the browser does, so a total can never be two different numbers
 * depending on who asked.
 */
import type { Bonus, Category, LowerCategory, Player, Turn, UpperCategory } from './types';

export const UPPER = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
] as const satisfies readonly UpperCategory[];

export const LOWER = [
  'threeOfAKind',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yahtzee',
  'chance',
] as const satisfies readonly LowerCategory[];

export const CATEGORIES = [...UPPER, ...LOWER] as const;

/** Five dice, six faces, so a sum of all five runs from 5 to 30. */
export const DICE = 5;
export const FACES = 6;

/** Reach this in the upper section and the bonus is yours. */
export const UPPER_TARGET = 63;
export const UPPER_BONUS = 35;
export const YAHTZEE_SCORE = 50;
export const YAHTZEE_BONUS = 100;

/** Boxes on a sheet, which is also how many turns a player takes. */
export const BOXES = CATEGORIES.length;

/** The face a box counts, so "fives" knows it is worth five a die. */
export const faceOf = (category: UpperCategory): number => UPPER.indexOf(category) + 1;

const isUpper = (category: Category): category is UpperCategory =>
  (UPPER as readonly string[]).includes(category);

/** The fixed payers: no dice arithmetic, you either made it or you did not. */
const FIXED: Partial<Record<Category, number>> = {
  fullHouse: 25,
  smallStraight: 30,
  largeStraight: 40,
  yahtzee: YAHTZEE_SCORE,
};

export const LABELS: Record<Category, string> = {
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  threeOfAKind: 'Three of a kind',
  fourOfAKind: 'Four of a kind',
  fullHouse: 'Full house',
  smallStraight: 'Small straight',
  largeStraight: 'Large straight',
  yahtzee: 'Yahtzee',
  chance: 'Chance',
};

/** The right-hand column of a paper sheet: what the box pays, in short. */
export const HINTS: Record<Category, string> = {
  ones: 'Count and add the ones',
  twos: 'Count and add the twos',
  threes: 'Count and add the threes',
  fours: 'Count and add the fours',
  fives: 'Count and add the fives',
  sixes: 'Count and add the sixes',
  threeOfAKind: 'Add all five dice',
  fourOfAKind: 'Add all five dice',
  fullHouse: 'Score 25',
  smallStraight: 'Four in a row, score 30',
  largeStraight: 'Five in a row, score 40',
  yahtzee: 'Five of a kind, score 50',
  chance: 'Add all five dice',
};

/**
 * Every number a box will take, low to high, with 0 first for a scratch.
 *
 * This is the whole of the entry rule. An upper box can only hold a multiple of
 * its own face, a fixed box holds its one number or nothing, and the three that
 * add the dice hold any sum five dice can make. Offering exactly these means a
 * wrong number cannot be typed rather than being caught afterwards.
 */
export function scoreOptions(category: Category): number[] {
  if (isUpper(category)) {
    const face = faceOf(category);
    return Array.from({ length: DICE + 1 }, (_, count) => count * face);
  }

  const fixed = FIXED[category];
  if (fixed !== undefined) return [0, fixed];

  // Three of a kind, four of a kind and chance all score the whole hand.
  const sums = Array.from({ length: DICE * FACES - DICE + 1 }, (_, i) => DICE + i);
  return [0, ...sums];
}

/** Whether a number is one this box could hold. */
export const isValidScore = (category: Category, value: number): boolean =>
  Number.isInteger(value) && scoreOptions(category).includes(value);

/** One player's sheet, every figure on it derived from the turns they took. */
export interface Sheet {
  /** The boxes filled in, by category. A scratched box is present and 0. */
  scores: Partial<Record<Category, number>>;
  upper: number;
  upperBonus: number;
  upperTotal: number;
  lower: number;
  /** Extra Yahtzees that count, which is none unless the box itself paid 50. */
  extraYahtzees: number;
  bonusPoints: number;
  total: number;
  filled: number;
  remaining: number;
  /** Points still needed for the upper bonus, or 0 once it is safe. */
  toTarget: number;
  /** Whether an extra Yahtzee can be claimed at all. */
  canClaimBonus: boolean;
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

export function sheetFor(
  turns: readonly Turn[],
  bonuses: readonly Bonus[],
  playerId: string,
): Sheet {
  const scores: Partial<Record<Category, number>> = {};
  for (const turn of turns) {
    if (turn.playerId === playerId) scores[turn.category] = turn.value;
  }

  const upper = sum(UPPER.map((c) => scores[c] ?? 0));
  const upperBonus = upper >= UPPER_TARGET ? UPPER_BONUS : 0;
  const lower = sum(LOWER.map((c) => scores[c] ?? 0));

  /**
   * An extra Yahtzee pays nothing unless the Yahtzee box itself is worth 50.
   * Deriving that rather than trusting the claims means correcting the box back
   * to a scratch takes the bonuses down with it, instead of leaving 100s behind
   * for a Yahtzee the sheet no longer says was rolled.
   */
  const claimable = scores.yahtzee === YAHTZEE_SCORE;
  const claimed = bonuses.filter((b) => b.playerId === playerId).length;
  const extraYahtzees = claimable ? claimed : 0;
  const bonusPoints = extraYahtzees * YAHTZEE_BONUS;

  const filled = CATEGORIES.filter((c) => scores[c] !== undefined).length;

  return {
    scores,
    upper,
    upperBonus,
    upperTotal: upper + upperBonus,
    lower,
    extraYahtzees,
    bonusPoints,
    total: upper + upperBonus + lower + bonusPoints,
    filled,
    remaining: BOXES - filled,
    toTarget: Math.max(0, UPPER_TARGET - upper),
    canClaimBonus: claimable,
  };
}

export const sheets = (
  players: readonly Player[],
  turns: readonly Turn[],
  bonuses: readonly Bonus[],
): Record<string, Sheet> =>
  Object.fromEntries(players.map((p) => [p.id, sheetFor(turns, bonuses, p.id)]));

export interface Standing {
  player: Player;
  sheet: Sheet;
}

/** Highest total first. A finished sheet breaks a tie against an unfinished one. */
export function standings(
  players: readonly Player[],
  turns: readonly Turn[],
  bonuses: readonly Bonus[],
): Standing[] {
  return players
    .map((player) => ({ player, sheet: sheetFor(turns, bonuses, player.id) }))
    .sort((a, b) =>
      b.sheet.total !== a.sheet.total
        ? b.sheet.total - a.sheet.total
        : a.sheet.remaining - b.sheet.remaining,
    );
}

/** Nobody has a box left. Nothing counts as finished before anyone has played. */
export const isOver = (
  players: readonly Player[],
  turns: readonly Turn[],
  bonuses: readonly Bonus[],
): boolean =>
  players.length > 0 && players.every((p) => sheetFor(turns, bonuses, p.id).remaining === 0);

/** Whoever is on the highest total, which can be more than one of them. */
export function winners(
  players: readonly Player[],
  turns: readonly Turn[],
  bonuses: readonly Bonus[],
): Player[] {
  if (!isOver(players, turns, bonuses)) return [];
  const rows = standings(players, turns, bonuses);
  const best = rows[0]!.sheet.total;
  return rows.filter((r) => r.sheet.total === best).map((r) => r.player);
}

/**
 * Which round the table is on, counting from one.
 *
 * Whoever has the fewest boxes filled decides it, so a round is over only once
 * everybody has taken it. Past the last round it stays at the last round rather
 * than reading as a fourteenth that does not exist.
 */
export function roundNumber(
  players: readonly Player[],
  turns: readonly Turn[],
  bonuses: readonly Bonus[],
): number {
  if (!players.length) return 1;
  const least = Math.min(...players.map((p) => sheetFor(turns, bonuses, p.id).filled));
  return Math.min(least + 1, BOXES);
}
