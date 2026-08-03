import { describe, expect, it } from 'vitest';
import { clearSession, readSession, writeSession } from './storage';

const SESSION = { game: 'cricket', code: 'AB2D', token: 't', memberId: 'm' } as const;

describe('remembering a room', () => {
  it('round trips', () => {
    writeSession(SESSION);
    expect(readSession('cricket')).toEqual(SESSION);
  });

  it('has nothing to say before you join one', () => {
    expect(readSession('cricket')).toBeNull();
  });

  it('forgets on request', () => {
    writeSession(SESSION);
    clearSession('cricket');
    expect(readSession('cricket')).toBeNull();
  });
});

/**
 * Sessions are stored per game, and separately from the solo save, so joining a
 * room can never overwrite the game someone was keeping on their own device.
 */
describe('keeping games apart', () => {
  it('does not hand one game the session of another', () => {
    writeSession(SESSION);
    expect(readSession('scrabble')).toBeNull();
    expect(readSession('rummikub')).toBeNull();
  });

  it('leaves the solo save alone', () => {
    localStorage.setItem('games.cricket.v1', '{"players":[]}');
    writeSession(SESSION);
    clearSession('cricket');
    expect(localStorage.getItem('games.cricket.v1')).toBe('{"players":[]}');
  });

  it('uses a key of its own', () => {
    writeSession(SESSION);
    expect(localStorage.getItem('games.room.cricket.v1')).toBeTruthy();
  });
});

describe('a stored session that makes no sense', () => {
  it.each([
    ['not JSON', 'nonsense{'],
    ['not an object', '42'],
    ['missing a token', '{"game":"cricket","code":"AB2D","memberId":"m"}'],
    ['an unknown game', '{"game":"chess","code":"AB2D","token":"t","memberId":"m"}'],
  ])('is ignored when it is %s', (_label, raw) => {
    localStorage.setItem('games.room.cricket.v1', raw);
    expect(readSession('cricket')).toBeNull();
  });

  // A session filed under the wrong game would seat someone in the wrong room.
  it('is ignored when it names a different game to the one asking', () => {
    localStorage.setItem(
      'games.room.cricket.v1',
      JSON.stringify({ game: 'scrabble', code: 'AB2D', token: 't', memberId: 'm' }),
    );
    expect(readSession('cricket')).toBeNull();
  });
});
