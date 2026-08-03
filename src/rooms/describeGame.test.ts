import { describe, expect, it } from 'vitest';
import { summarise } from './describeGame';

/**
 * This is the text of a warning shown before a game is cleared, so it has to be
 * silent when there is nothing to lose and specific when there is.
 */
describe('summarise', () => {
  it('says nothing about an empty game', () => {
    expect(summarise([[0, 'player'], [0, 'turn']])).toBeNull();
  });

  it('mentions only the parts that exist', () => {
    expect(summarise([[3, 'player'], [0, 'turn']])).toBe('3 players');
    expect(summarise([[0, 'player'], [1, 'round']])).toBe('1 round');
  });

  it('joins two parts readably', () => {
    expect(summarise([[3, 'player'], [12, 'turn']])).toBe('3 players and 12 turns');
  });

  it('joins three with a comma', () => {
    expect(summarise([[1, 'player'], [2, 'turn'], [3, 'round']]))
      .toBe('1 player, 2 turns and 3 rounds');
  });

  it('gets singulars right', () => {
    expect(summarise([[1, 'player'], [1, 'turn']])).toBe('1 player and 1 turn');
  });
});
