import type { Player, Round } from './types';

/** A joker left on the rack costs 30, whatever else is going on. */
export const JOKER_PENALTY = 30;

/** Number tiles run 1 to 13 and are worth their face value. */
export const TILE_VALUES: readonly number[] = Array.from({ length: 13 }, (_, i) => i + 1);

/** The highest rack a player can be caught with: 14 tiles, all jokers aside. */
export const MAX_SENSIBLE_PENALTY = 13 * 14;

export const isJoker = (tile: number): boolean => tile === JOKER_PENALTY;

/**
 * What a round is worth to each player.
 *
 * Everyone still holding tiles scores their rack as a negative, and the winner
 * scores the positive sum of all of it. Totals therefore net to zero within a
 * round, which is what makes the running scoreboard self-checking.
 *
 * Only players currently in the game are counted, so removing someone rescores
 * the rounds they took part in rather than leaving a phantom contribution.
 */
export function roundScores(
  players: readonly Player[],
  round: Round,
): Record<string, number> {
  const scores: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  if (!players.some((p) => p.id === round.winnerId)) return scores;

  let pot = 0;
  for (const player of players) {
    if (player.id === round.winnerId) continue;
    const penalty = round.penalties[player.id] ?? 0;
    scores[player.id] = penalty === 0 ? 0 : -penalty; // avoid -0
    pot += penalty;
  }
  scores[round.winnerId] = pot;
  return scores;
}

export interface Standing {
  player: Player;
  score: number;
  /** Rounds this player went out on. */
  wins: number;
}

export function standings(players: readonly Player[], rounds: readonly Round[]): Standing[] {
  const totals: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  const wins: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));

  for (const round of rounds) {
    const scores = roundScores(players, round);
    for (const player of players) totals[player.id] = (totals[player.id] ?? 0) + (scores[player.id] ?? 0);
    if (wins[round.winnerId] !== undefined) wins[round.winnerId]! += 1;
  }

  return players
    .map((player) => ({
      player,
      score: totals[player.id] ?? 0,
      wins: wins[player.id] ?? 0,
    }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.wins - a.wins));
}

/** Running total for one player, used by the history rows. */
export const scoreFor = (
  players: readonly Player[],
  rounds: readonly Round[],
  playerId: string,
): number => standings(players, rounds).find((s) => s.player.id === playerId)?.score ?? 0;

/**
 * The winner's score for a round in progress: the sum of what everyone else is
 * still holding.
 */
export const potFor = (penalties: Record<string, number>, players: readonly Player[], winnerId: string): number =>
  players.reduce((sum, p) => (p.id === winnerId ? sum : sum + (penalties[p.id] ?? 0)), 0);
