import { describe, expect, it } from 'vitest';
import { TARGETS, computeBoard, dartShorthand, previewTurn, standings } from './cricket';
import type { CricketTarget, Dart, Player, Turn, Variant } from './types';

const ada: Player = { id: 'a', name: 'Ada', joinedAtTurn: 0 };
const grace: Player = { id: 'g', name: 'Grace', joinedAtTurn: 0 };
const alan: Player = { id: 'l', name: 'Alan', joinedAtTurn: 0 };
const two = [ada, grace];
const three = [ada, grace, alan];

const d = (target: CricketTarget | 0, multiplier: 1 | 2 | 3 = 1): Dart => ({ target, multiplier });

let seq = 0;
const turn = (playerId: string, ...darts: Dart[]): Turn => ({ id: `t${seq++}`, playerId, darts });

/** Throw `count` triple-<target>s for a player, as separate turns. */
const triples = (playerId: string, target: CricketTarget, count: number): Turn[] =>
  Array.from({ length: count }, () => turn(playerId, d(target, 3)));

/** Close every target for a player without ever scoring a point. */
const closeAll = (playerId: string): Turn[] => TARGETS.flatMap((t) => triples(playerId, t, 1));

/** Close everything except one target that has already been closed. */
const closeRest = (playerId: string, skip: CricketTarget): Turn[] =>
  TARGETS.filter((t) => t !== skip).flatMap((t) => triples(playerId, t, 1));

const board = (players: Player[], turns: Turn[], variant: Variant = 'standard') =>
  computeBoard(players, turns, variant);

describe('marks', () => {
  it('counts a single as one mark, a double as two and a triple as three', () => {
    const b = board(two, [turn('a', d(20), d(19, 2), d(18, 3))]);
    expect(b.marks.a?.[20]).toBe(1);
    expect(b.marks.a?.[19]).toBe(2);
    expect(b.marks.a?.[18]).toBe(3);
  });

  it('caps marks at three', () => {
    const b = board(two, [turn('a', d(20, 3), d(20, 3))]);
    expect(b.marks.a?.[20]).toBe(3);
  });

  it('ignores a miss', () => {
    const b = board(two, [turn('a', d(0), d(0), d(0))]);
    expect(b.marks.a?.[20]).toBe(0);
    expect(b.points.a).toBe(0);
  });

  it('treats the outer bull as one mark and the inner as two', () => {
    expect(board(two, [turn('a', d(25))]).marks.a?.[25]).toBe(1);
    expect(board(two, [turn('a', d(25, 2))]).marks.a?.[25]).toBe(2);
  });
});

describe('scoring', () => {
  it('scores nothing until the number is closed', () => {
    const b = board(two, [turn('a', d(20), d(20))]);
    expect(b.points.a).toBe(0);
  });

  it('scores only the marks beyond closing', () => {
    // Two marks already down; a triple closes with one and scores the other two.
    const b = board(two, [turn('a', d(20), d(20)), turn('a', d(20, 3))]);
    expect(b.marks.a?.[20]).toBe(3);
    expect(b.points.a).toBe(40);
  });

  it('scores a full triple once the number is closed', () => {
    const b = board(two, [...triples('a', 20, 1), turn('a', d(20, 3))]);
    expect(b.points.a).toBe(60);
  });

  it('scores the bull at 25 a mark', () => {
    const b = board(two, [...triples('a', 25, 3), turn('a', d(25, 2))]);
    // Three turns of "triple bull" is not throwable, but marks cap the same way:
    // the point here is that a closed bull pays 25 per surplus mark.
    expect(b.marks.a?.[25]).toBe(3);
    expect(b.points.a).toBeGreaterThan(0);
  });

  it('stops paying once every opponent has closed the number', () => {
    const turns = [
      ...triples('a', 20, 1), // Ada closes 20
      ...triples('g', 20, 1), // Grace closes 20 - the number is now dead
      turn('a', d(20, 3)),    // scores nothing
    ];
    const b = board(two, turns);
    expect(b.dead[20]).toBe(true);
    expect(b.points.a).toBe(0);
  });

  it('keeps paying while any one opponent still has it open', () => {
    const turns = [
      ...triples('a', 18, 1),
      ...triples('g', 18, 1), // Grace closes, Alan has not
      turn('a', d(18, 3)),
    ];
    const b = board(three, turns);
    expect(b.dead[18]).toBe(false);
    expect(b.points.a).toBe(54);
  });

  it('splits a dart that both closes and scores against a dead number correctly', () => {
    // Grace closes 17 first. Ada then triples 17: one mark closes, two would
    // score, but Grace is the only opponent and she has closed it.
    const turns = [...triples('g', 17, 1), turn('a', d(17), d(17), d(17, 3))];
    const b = board(two, turns);
    expect(b.marks.a?.[17]).toBe(3);
    expect(b.points.a).toBe(0);
  });
});

describe('a player who joins mid-game', () => {
  const late = (joinedAtTurn: number): Player => ({ id: 'l', name: 'Alan', joinedAtTurn });

  // Scores are derived by replaying every dart, so without a join point a new
  // arrival would be treated as having had all seven targets open from dart one.
  it('does not retroactively open targets that were dead at the time', () => {
    const turns = [
      ...triples('a', 20, 1), // Ada closes 20
      ...triples('g', 20, 1), // Grace closes 20, so 20 is dead
      turn('a', d(20, 3)),    // scored nothing when it was thrown
    ];
    expect(board(two, turns).points.a).toBe(0);
    expect(board([...two, late(3)], turns).points.a).toBe(0);
  });

  it('is not dealt points in cut-throat for throws made before joining', () => {
    const turns = [...triples('a', 20, 1), turn('a', d(20, 3))];
    const b = board([...two, late(2)], turns, 'cutthroat');
    expect(b.points.g).toBe(60);
    expect(b.points.l).toBe(0);
  });

  it('does take part from the moment they join', () => {
    const turns = [
      ...triples('a', 20, 1),  // turn 0: Ada closes 20
      ...triples('g', 20, 1),  // turn 1: Grace closes 20
      turn('a', d(20, 3)),     // turn 2: dead for the original two
    ];
    // Alan joins before that last throw, so 20 is open again and it pays.
    expect(board([...two, late(2)], turns).points.a).toBe(60);
  });

  it('treats a missing join point as having been there all along', () => {
    const turns = [...triples('a', 20, 1), turn('a', d(20, 3))];
    const legacy = { id: 'l', name: 'Alan' } as unknown as Player;
    expect(board([...two, legacy], turns).points.a).toBe(60);
  });
});

describe('malformed input', () => {
  it('survives a turn with no darts rather than throwing', () => {
    const broken = [{ id: 'x', playerId: 'a' } as unknown as Turn];
    expect(() => board(two, broken)).not.toThrow();
    expect(board(two, broken).points.a).toBe(0);
  });
});

describe('cut-throat', () => {
  it('deals points to opponents who have not closed the number', () => {
    const turns = [...triples('a', 20, 1), turn('a', d(20, 3))];
    const b = board(three, turns, 'cutthroat');
    expect(b.points.a).toBe(0);
    expect(b.points.g).toBe(60);
    expect(b.points.l).toBe(60);
  });

  it('spares an opponent who has already closed the number', () => {
    const turns = [
      ...triples('a', 20, 1),
      ...triples('g', 20, 1), // Grace is safe on 20
      turn('a', d(20, 3)),    // only Alan takes it
    ];
    const b = board(three, turns, 'cutthroat');
    expect(b.points.g).toBe(0);
    expect(b.points.l).toBe(60);
  });
});

describe('no points mode', () => {
  it('never awards points, however many surplus marks are thrown', () => {
    const turns = [...triples('a', 20, 1), turn('a', d(20, 3), d(20, 3), d(20, 3))];
    const b = board(two, turns, 'nopoints');
    expect(b.points.a).toBe(0);
    expect(b.points.g).toBe(0);
    expect(b.marks.a?.[20]).toBe(3);
  });

  it('is won by the first player to close all seven targets', () => {
    const b = board(two, closeAll('a'), 'nopoints');
    expect(b.winnerId).toBe('a');
  });

  it('is won even by a player who would be behind on points elsewhere', () => {
    // Grace banks marks that would be 60 points in standard play.
    const turns = [...triples('g', 20, 1), turn('g', d(20, 3)), ...closeAll('a')];
    expect(board(two, turns, 'standard').winnerId).toBeNull();
    expect(board(two, turns, 'nopoints').winnerId).toBe('a');
  });

  it('ranks players by marks thrown', () => {
    const turns = [...triples('a', 20, 1), ...triples('g', 19, 1), ...triples('g', 18, 1)];
    const b = board(two, turns, 'nopoints');
    expect(standings(two, b, 'nopoints').map((s) => s.player.id)).toEqual(['g', 'a']);
  });

  it('previews marks but no points', () => {
    const existing = [...triples('a', 20, 1)];
    expect(previewTurn(two, existing, 'nopoints', 'a', [d(20, 3), d(19)]))
      .toEqual({ marks: 1, points: 0 });
  });
});

describe('winning', () => {
  it('is won by closing everything while level or ahead on points', () => {
    const b = board(two, closeAll('a'));
    expect(b.winnerId).toBe('a');
  });

  it('is not won by closing everything while behind on points', () => {
    // Grace closes 20 and banks 60, then Ada closes all seven with no points.
    const turns = [...triples('g', 20, 1), turn('g', d(20, 3)), ...closeAll('a')];
    const b = board(two, turns);
    expect(b.hasClosedAll.a).toBe(true);
    expect(b.winnerId).toBeNull();
  });

  it('is won once the trailing player catches up on points', () => {
    const turns = [
      ...triples('g', 20, 1),
      turn('g', d(20, 3)),        // Grace 60
      ...closeAll('a'),           // Ada closed out but on 0
      turn('a', d(19, 3)),        // 19 still open for Grace: 57
      turn('a', d(19, 3)),        // 114 - now ahead
    ];
    const b = board(two, turns);
    expect(b.points.a).toBe(114);
    expect(b.winnerId).toBe('a');
  });

  it('records no darts after the game has been won', () => {
    const turns = [...closeAll('a'), turn('g', d(20, 3)), turn('g', d(20, 3))];
    const b = board(two, turns);
    expect(b.winnerId).toBe('a');
    expect(b.points.g).toBe(0);
  });

  it('is won in cut-throat by closing out with the lowest score', () => {
    // Ada closes 20, deals 60 to Grace, then closes the other six.
    const turns = [...triples('a', 20, 1), turn('a', d(20, 3)), ...closeRest('a', 20)];
    const b = board(two, turns, 'cutthroat');
    expect(b.points.a).toBe(0);
    expect(b.points.g).toBe(60);
    expect(b.winnerId).toBe('a');
  });
});

describe('standings', () => {
  it('ranks the highest score first in standard play', () => {
    const turns = [...triples('a', 20, 1), turn('a', d(20, 3))];
    const b = board(two, turns);
    expect(standings(two, b, 'standard').map((s) => s.player.id)).toEqual(['a', 'g']);
  });

  it('ranks the lowest score first in cut-throat', () => {
    const turns = [...triples('a', 20, 1), turn('a', d(20, 3))];
    const b = board(two, turns, 'cutthroat');
    expect(standings(two, b, 'cutthroat').map((s) => s.player.id)).toEqual(['a', 'g']);
  });

  it('breaks a points tie on marks thrown', () => {
    const b = board(two, [...triples('a', 20, 1)]);
    expect(standings(two, b, 'standard')[0]?.player.id).toBe('a');
  });
});

describe('previewTurn', () => {
  it('reports the marks and points a throw would add', () => {
    const existing = [...triples('a', 20, 1)];
    expect(previewTurn(two, existing, 'standard', 'a', [d(20, 3), d(19)]))
      .toEqual({ marks: 1, points: 60 });
  });

  it('reports points dealt to opponents in cut-throat', () => {
    const existing = [...triples('a', 20, 1)];
    expect(previewTurn(three, existing, 'cutthroat', 'a', [d(20, 3)]))
      .toEqual({ marks: 0, points: 120 });
  });
});

describe('dartShorthand', () => {
  it.each([
    [d(20, 3), 'T20'],
    [d(19, 2), 'D19'],
    [d(15), 'S15'],
    [d(25), 'B'],
    [d(25, 2), 'DB'],
    [d(0), '-'],
  ])('renders %o as %s', (dart, expected) => {
    expect(dartShorthand(dart)).toBe(expected);
  });
});
