export interface Player {
  id: string;
  name: string;
}

/**
 * One round of play. The winner is whoever went out; everyone else is scored
 * on the tiles left on their rack, keyed by player id.
 */
export interface Round {
  id: string;
  winnerId: string;
  penalties: Record<string, number>;
}

export type RummikubState = {
  players: Player[];
  rounds: Round[];
};
