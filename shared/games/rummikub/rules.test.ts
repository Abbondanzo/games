import { describe, expect, it } from 'vitest';
import { JOKER_PENALTY, potFor, roundScores, standings } from './rules';
import type { Player, Round } from './types';

const ada: Player = { id: 'a', name: 'Ada' };
const grace: Player = { id: 'g', name: 'Grace' };
const alan: Player = { id: 'l', name: 'Alan' };
const two = [ada, grace];
const three = [ada, grace, alan];

let seq = 0;
const round = (winnerId: string, penalties: Record<string, number>): Round =>
  ({ id: `r${seq++}`, winnerId, penalties });

describe('roundScores', () => {
  it('pays the winner the sum of everyone else’s rack', () => {
    const scores = roundScores(three, round('a', { g: 24, l: 41 }));
    expect(scores).toEqual({ a: 65, g: -24, l: -41 });
  });

  it('nets to zero across the table', () => {
    const scores = roundScores(three, round('g', { a: 13, l: 7 }));
    expect(Object.values(scores).reduce((x, y) => x + y, 0)).toBe(0);
  });

  it('treats a missing penalty as an empty rack', () => {
    expect(roundScores(three, round('a', { g: 10 }))).toEqual({ a: 10, g: -10, l: 0 });
  });

  it('scores a round where everyone else went out clean', () => {
    expect(roundScores(two, round('a', {}))).toEqual({ a: 0, g: 0 });
  });

  it('ignores a round whose winner is no longer playing', () => {
    expect(roundScores(two, round('gone', { a: 10, g: 5 }))).toEqual({ a: 0, g: 0 });
  });

  it('drops the contribution of a player who has left', () => {
    // Alan's 41 no longer counts once he is out of the game.
    expect(roundScores(two, round('a', { g: 24, l: 41 }))).toEqual({ a: 24, g: -24 });
  });
});

describe('joker', () => {
  it('costs 30', () => {
    expect(JOKER_PENALTY).toBe(30);
  });

  it('is just part of the rack total', () => {
    // Grace holds a 5, a 12 and a joker.
    const scores = roundScores(two, round('a', { g: 5 + 12 + JOKER_PENALTY }));
    expect(scores).toEqual({ a: 47, g: -47 });
  });
});

describe('standings', () => {
  const rounds = [
    round('a', { g: 24, l: 41 }), // Ada +65
    round('l', { a: 30, g: 12 }), // Alan +42
  ];

  it('accumulates across rounds and ranks by total', () => {
    expect(standings(three, rounds).map((s) => [s.player.name, s.score])).toEqual([
      ['Alan', 1],   // -41 + 42
      ['Ada', 35],   // 65 - 30
      ['Grace', -36], // -24 - 12
    ].sort((x, y) => (y[1] as number) - (x[1] as number)));
  });

  it('counts rounds won', () => {
    const wins = Object.fromEntries(standings(three, rounds).map((s) => [s.player.name, s.wins]));
    expect(wins).toEqual({ Ada: 1, Grace: 0, Alan: 1 });
  });

  it('still nets to zero once every round is counted', () => {
    const sum = standings(three, rounds).reduce((acc, s) => acc + s.score, 0);
    expect(sum).toBe(0);
  });

  it('breaks a tie on rounds won', () => {
    const tied = [round('a', {}), round('g', {})]; // both on 0
    const order = standings(two, [...tied, round('a', {})]).map((s) => s.player.name);
    expect(order[0]).toBe('Ada');
  });

  it('starts everyone at zero before any round', () => {
    expect(standings(three, []).every((s) => s.score === 0 && s.wins === 0)).toBe(true);
  });
});

describe('potFor', () => {
  it('totals what the winner is about to collect', () => {
    expect(potFor({ g: 24, l: 41 }, three, 'a')).toBe(65);
  });

  it('never counts the winner’s own entry', () => {
    expect(potFor({ a: 99, g: 5 }, two, 'a')).toBe(5);
  });
});
