import type { CricketTarget, Dart, Player, Turn, Variant } from './types';

/** Board order, highest first - how a cricket scoreboard is always written. */
export const TARGETS: readonly CricketTarget[] = [20, 19, 18, 17, 16, 15, 25];

export const MARKS_TO_CLOSE = 3;

export const DARTS_PER_TURN = 3;

export const targetLabel = (target: CricketTarget): string => (target === 25 ? 'Bull' : String(target));

/** How many marks a dart is worth. A miss is worth none. */
export const dartMarks = (dart: Dart): number => (dart.target === 0 ? 0 : dart.multiplier);

export function dartLabel(dart: Dart): string {
  if (dart.target === 0) return 'Miss';
  if (dart.target === 25) return dart.multiplier === 2 ? 'Double bull' : 'Bull';
  return `${['', 'Single', 'Double', 'Triple'][dart.multiplier]} ${dart.target}`;
}

/** Compact form for the dart chips and history: T20, D19, Bull, DB, -. */
export function dartShorthand(dart: Dart): string {
  if (dart.target === 0) return '-';
  if (dart.target === 25) return dart.multiplier === 2 ? 'DB' : 'B';
  return `${['', 'S', 'D', 'T'][dart.multiplier]}${dart.target}`;
}

export type MarkTable = Record<string, Record<number, number>>;

export interface BoardState {
  /** Marks per player per target, capped at MARKS_TO_CLOSE. */
  marks: MarkTable;
  points: Record<string, number>;
  /** Targets this player has closed. */
  hasClosedAll: Record<string, boolean>;
  /** Targets closed by every player - nobody can score on these any more. */
  dead: Record<number, boolean>;
  winnerId: string | null;
}

const emptyMarks = (players: readonly Player[]): MarkTable =>
  Object.fromEntries(players.map((p) => [p.id, Object.fromEntries(TARGETS.map((t) => [t, 0]))]));

/** Players who had joined by the time the turn at `turnIndex` was thrown. */
const playersAt = (players: readonly Player[], turnIndex: number): Player[] =>
  players.filter((p) => (p.joinedAtTurn ?? 0) <= turnIndex);

/**
 * Whether a player who has already closed `target` can still score on it:
 * only while at least one opponent has it open.
 */
function scoringIsOpen(
  marks: MarkTable,
  players: readonly Player[],
  throwerId: string,
  target: CricketTarget,
): boolean {
  return players.some((p) => p.id !== throwerId && (marks[p.id]?.[target] ?? 0) < MARKS_TO_CLOSE);
}

/**
 * Replay every dart in order. Scoring depends on who had closed what at the
 * moment a dart landed, so this cannot be derived from final totals.
 */
export function computeBoard(
  players: readonly Player[],
  turns: readonly Turn[],
  variant: Variant,
): BoardState {
  const marks = emptyMarks(players);
  const points: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));
  const known = new Set(players.map((p) => p.id));

  let winnerId: string | null = null;

  for (const [turnIndex, turn] of turns.entries()) {
    if (winnerId || !known.has(turn.playerId)) continue;

    // Someone who joined later was not at the board for this throw.
    const atTheBoard = playersAt(players, turnIndex);

    for (const dart of turn.darts ?? []) {
      if (winnerId) break;
      if (dart.target === 0) continue;

      const target = dart.target;
      const playerMarks = marks[turn.playerId]!;
      const current = playerMarks[target] ?? 0;

      const hits = dartMarks(dart);
      const usedToClose = Math.min(hits, MARKS_TO_CLOSE - current);
      playerMarks[target] = current + usedToClose;

      // Marks beyond closing score, but only while an opponent still has it open.
      const surplus = hits - usedToClose;
      if (variant !== 'nopoints'
        && surplus > 0
        && scoringIsOpen(marks, atTheBoard, turn.playerId, target)) {
        const scored = surplus * target;
        if (variant === 'cutthroat') {
          // Points are dealt to everyone who has not closed the number.
          for (const p of atTheBoard) {
            if (p.id === turn.playerId) continue;
            if ((marks[p.id]?.[target] ?? 0) < MARKS_TO_CLOSE) points[p.id] = (points[p.id] ?? 0) + scored;
          }
        } else {
          points[turn.playerId] = (points[turn.playerId] ?? 0) + scored;
        }
      }

      winnerId = findWinner(atTheBoard, marks, points, variant);
    }
  }

  const hasClosedAll = Object.fromEntries(
    players.map((p) => [p.id, TARGETS.every((t) => (marks[p.id]?.[t] ?? 0) >= MARKS_TO_CLOSE)]),
  );
  const dead = Object.fromEntries(
    TARGETS.map((t) => [
      t,
      players.length > 0 && players.every((p) => (marks[p.id]?.[t] ?? 0) >= MARKS_TO_CLOSE),
    ]),
  );

  return { marks, points, hasClosedAll, dead, winnerId };
}

/**
 * A player wins by closing all seven targets while not losing on points:
 * ahead or level in standard, behind or level in cut-throat. With points
 * switched off, closing out is the whole game.
 */
function findWinner(
  players: readonly Player[],
  marks: MarkTable,
  points: Record<string, number>,
  variant: Variant,
): string | null {
  for (const player of players) {
    const closedAll = TARGETS.every((t) => (marks[player.id]?.[t] ?? 0) >= MARKS_TO_CLOSE);
    if (!closedAll) continue;
    if (variant === 'nopoints') return player.id;

    const mine = points[player.id] ?? 0;
    const beatsEveryone = players.every((other) => {
      if (other.id === player.id) return true;
      const theirs = points[other.id] ?? 0;
      return variant === 'cutthroat' ? mine <= theirs : mine >= theirs;
    });
    if (beatsEveryone) return player.id;
  }
  return null;
}

export interface Standing {
  player: Player;
  points: number;
  marks: number;
  closedAll: boolean;
}

/** Players in rank order - best first, which flips for cut-throat. */
export function standings(
  players: readonly Player[],
  board: BoardState,
  variant: Variant,
): Standing[] {
  return players
    .map((player) => ({
      player,
      points: board.points[player.id] ?? 0,
      marks: TARGETS.reduce((sum, t) => sum + (board.marks[player.id]?.[t] ?? 0), 0),
      closedAll: board.hasClosedAll[player.id] ?? false,
    }))
    .sort((a, b) => {
      if (variant === 'nopoints') return b.marks - a.marks;
      if (a.points !== b.points) {
        return variant === 'cutthroat' ? a.points - b.points : b.points - a.points;
      }
      return b.marks - a.marks; // more marks is further along when points are level
    });
}

/** Marks and points a set of darts would add, for the live turn preview. */
export function previewTurn(
  players: readonly Player[],
  turns: readonly Turn[],
  variant: Variant,
  playerId: string,
  darts: readonly Dart[],
): { marks: number; points: number } {
  const before = computeBoard(players, turns, variant);
  const after = computeBoard(
    players,
    [...turns, { id: 'preview', playerId, darts: [...darts] }],
    variant,
  );

  const totalMarks = (b: typeof before) =>
    TARGETS.reduce((sum, t) => sum + (b.marks[playerId]?.[t] ?? 0), 0);

  // In cut-throat the damage lands on opponents, so report what the throw dealt.
  const dealt = (b: typeof before) =>
    variant === 'cutthroat'
      ? players.reduce((sum, p) => (p.id === playerId ? sum : sum + (b.points[p.id] ?? 0)), 0)
      : (b.points[playerId] ?? 0);

  return {
    marks: totalMarks(after) - totalMarks(before),
    points: dealt(after) - dealt(before),
  };
}
