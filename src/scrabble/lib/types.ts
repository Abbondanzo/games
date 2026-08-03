/** A letter multiplier from the board square the tile sits on. */
export type LetterMult = 1 | 2 | 3;

/** A word multiplier. 4, 6 and 9 happen when one play covers two premium word squares. */
export type WordMult = 1 | 2 | 3 | 4 | 6 | 9;

export interface Tile {
  ch: string;
  lm: LetterMult;
  /** Blank tiles score zero but still sit under any word multiplier. */
  blank: boolean;
}

export interface Player {
  id: string;
  name: string;
}

/** A word banked into the current turn. One play can form several. */
export interface ScoredWord {
  word: string;
  points: number;
}

export type TurnKind = 'play' | 'pass' | 'adjust';

export interface Turn {
  id: string;
  playerId: string;
  kind: TurnKind;
  words: string[];
  bingo: boolean;
  points: number;
}

export interface GameState {
  players: Player[];
  turns: Turn[];
  /** Index into `players` of whoever is up next. */
  currentIndex: number;
}

/** The turn being entered, held outside the persisted game state. */
export interface Draft {
  tiles: Tile[];
  wordMult: WordMult;
  bingo: boolean;
  words: ScoredWord[];
}
