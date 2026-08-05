import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession, deviceFor, newDevice, readSession, rememberDevice, writeSession,
} from './storage';

beforeEach(() => localStorage.clear());

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

/**
 * The secret that lets a device come back as itself.
 *
 * It carries the whole of identity in a room, so what matters is that it is
 * unguessable, that it survives leaving, and that it never turns up anywhere a
 * person or another device could read it.
 */
describe('the secret a device keeps for a room', () => {
  it('is the same one every time for the same room', () => {
    const first = deviceFor('cricket', 'AB23');
    expect(deviceFor('cricket', 'AB23')).toBe(first);
  });

  it('is a different one for a different room', () => {
    // Nothing should link a device across two rooms.
    expect(deviceFor('cricket', 'AB23')).not.toBe(deviceFor('cricket', 'CD45'));
  });

  /**
   * One slot per game was not enough. Joining or hosting anything else forgot
   * the first room, so coming back to it made a second player - and put a
   * removal two taps from being undone.
   */
  it('is not forgotten by visiting another room', () => {
    const first = deviceFor('cricket', 'AB23');
    deviceFor('cricket', 'CD45');
    rememberDevice('cricket', 'EF67', newDevice());

    expect(deviceFor('cricket', 'AB23')).toBe(first);
  });

  it('does not grow without bound', () => {
    const codes = Array.from({ length: 30 }, (_, i) => `R${i}`);
    for (const code of codes) deviceFor('cricket', code);

    const stored = JSON.parse(localStorage.getItem('games.room.cricket.device.v1')!) as object;
    expect(Object.keys(stored).length).toBeLessThanOrEqual(8);
    // The most recent survive; the oldest are the ones dropped.
    expect(Object.keys(stored)).toContain('R29');
    expect(Object.keys(stored)).not.toContain('R0');
  });

  it('shrugs at a stored value that is nonsense', () => {
    localStorage.setItem('games.room.cricket.device.v1', '"not an object"');
    // A fresh one, rather than a throw or an empty string.
    expect(deviceFor('cricket', 'AB23').length).toBeGreaterThanOrEqual(24);
  });

  it('is a different one for a different game', () => {
    expect(deviceFor('cricket', 'AB23')).not.toBe(deviceFor('scrabble', 'AB23'));
  });

  it('is long enough not to be guessed', () => {
    expect(deviceFor('cricket', 'AB23').length).toBeGreaterThanOrEqual(24);
  });

  it('is not the same twice running', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      localStorage.clear();
      seen.add(deviceFor('cricket', 'AB23'));
    }
    expect(seen.size).toBe(50);
  });

  // Leaving is exactly when it has to survive, so it is kept apart from the
  // session, which is cleared on the way out.
  it('outlives the session', () => {
    const secret = deviceFor('cricket', 'AB23');
    writeSession({ game: 'cricket', code: 'AB23', token: 't', memberId: 'm' });
    clearSession('cricket');

    expect(deviceFor('cricket', 'AB23')).toBe(secret);
    expect(readSession('cricket')).toBeNull();
  });

  it('is minted for hosting before the code is known, then kept', () => {
    const secret = newDevice();
    rememberDevice('cricket', 'AB23', secret);
    expect(deviceFor('cricket', 'AB23')).toBe(secret);
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private browsing');
    });
    expect(() => deviceFor('cricket', 'AB23')).not.toThrow();
    vi.restoreAllMocks();
  });
});
