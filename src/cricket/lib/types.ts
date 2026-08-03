/** The seven targets in play. 25 is the bull. */
export type CricketTarget = 15 | 16 | 17 | 18 | 19 | 20 | 25;

/** A thrown dart. `target: 0` is a miss (or a hit on a number not in play). */
export interface Dart {
  target: CricketTarget | 0;
  /** Rings hit: 1 single, 2 double, 3 triple. On the bull, 1 outer and 2 inner. */
  multiplier: 1 | 2 | 3;
}

export interface Player {
  id: string;
  name: string;
  /**
   * How many turns had been played when this player joined. Darts thrown
   * before that point are scored as if the player was not at the board, so
   * adding someone mid-game cannot rewrite history.
   */
  joinedAtTurn: number;
}

export interface Turn {
  id: string;
  playerId: string;
  darts: Dart[];
}

/**
 * Standard: points you score are your own and the highest score wins.
 * Cut-throat: points are dealt to opponents who have not closed the number,
 * and the lowest score wins.
 * No points: marks only. First to close all seven targets wins.
 */
export type Variant = 'standard' | 'cutthroat' | 'nopoints';

export interface CricketState {
  players: Player[];
  turns: Turn[];
  currentIndex: number;
  variant: Variant;
}
