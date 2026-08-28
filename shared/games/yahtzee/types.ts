/** The six boxes at the top of the sheet, scored on matching dice only. */
export type UpperCategory = 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes';

/** The seven below the line, where the combination decides what a box pays. */
export type LowerCategory =
  | 'threeOfAKind'
  | 'fourOfAKind'
  | 'fullHouse'
  | 'smallStraight'
  | 'largeStraight'
  | 'yahtzee'
  | 'chance';

export type Category = UpperCategory | LowerCategory;

export interface Player {
  id: string;
  name: string;
}

/**
 * One turn: a player writing one number into one box.
 *
 * A turn and a filled box are the same event in Yahtzee - you roll, you commit
 * to a box, and that box is spent - so there is no separate record of a turn.
 * A box scratched for nothing is a turn like any other, with a value of 0.
 */
export interface Turn {
  id: string;
  playerId: string;
  category: Category;
  value: number;
}

/**
 * An extra Yahtzee, rolled once the Yahtzee box is already worth 50.
 *
 * Its own event rather than a number on the player, because it does not end a
 * turn: the roll still has to be written into some other box, so the turn that
 * carries it is recorded separately.
 */
export interface Bonus {
  id: string;
  playerId: string;
}

export type YahtzeeState = {
  players: Player[];
  turns: Turn[];
  bonuses: Bonus[];
  currentIndex: number;
};
