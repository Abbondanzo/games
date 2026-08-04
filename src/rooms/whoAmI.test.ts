/**
 * The questions the trackers ask about the room.
 *
 * Each has a solo answer and a room answer, and the solo one is the easy one to
 * get wrong: there is no room object to ask, so every one of these has to mean
 * something sensible when handed null.
 */
import { describe, expect, it, vi } from 'vitest';
import { allowed, blocked, isHost, isMyTurn, myName, mySeat, renameSelf } from './whoAmI';
import type { RoomHandle } from './session';

const PLAYERS = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Grace' }];

/** Only the parts these functions touch; the rest of a room is not their business. */
const room = (over: Partial<RoomHandle> = {}): RoomHandle => ({
  role: 'player',
  seatId: 'p2',
  sending: false,
  can: () => true,
  ...over,
} as RoomHandle);

describe('being the host', () => {
  it('is true playing alone, where there is nobody to be host over', () => {
    expect(isHost(null)).toBe(true);
  });

  it('is true for the host of a room', () => {
    expect(isHost(room({ role: 'host' }))).toBe(true);
  });

  it('is false for anyone who joined', () => {
    expect(isHost(room({ role: 'player' }))).toBe(false);
  });
});

describe('finding your own player', () => {
  it('is nobody when playing alone', () => {
    expect(mySeat(null, PLAYERS)).toBeNull();
    expect(myName(null, PLAYERS)).toBeNull();
  });

  it('is the player your seat points at', () => {
    expect(mySeat(room({ seatId: 'p1' }), PLAYERS)).toEqual(PLAYERS[0]);
    expect(myName(room({ seatId: 'p1' }), PLAYERS)).toBe('Ada');
  });

  it('is nobody when watching without a seat', () => {
    expect(myName(room({ seatId: null }), PLAYERS)).toBeNull();
  });

  // The host can remove a player, and the seat goes before the render does.
  it('is nobody when the seat points at a player who has gone', () => {
    expect(myName(room({ seatId: 'deleted' }), PLAYERS)).toBeNull();
  });
});

describe('whether it is your turn', () => {
  it('does not arise playing alone', () => {
    expect(isMyTurn(null, 'p1')).toBeNull();
  });

  it('is true when the turn is on your seat', () => {
    expect(isMyTurn(room({ seatId: 'p2' }), 'p2')).toBe(true);
  });

  it('is false when it is somebody else', () => {
    expect(isMyTurn(room({ seatId: 'p2' }), 'p1')).toBe(false);
  });

  it('is false with nobody up at all', () => {
    expect(isMyTurn(room({ seatId: 'p2' }), null)).toBe(false);
  });

  /**
   * A spectator has no seat and a game with no players has no current player.
   * Both are null, and null matching null would put a watcher on turn.
   */
  it('is false for a watcher in a game with nobody up', () => {
    expect(isMyTurn(room({ seatId: null }), null)).toBe(false);
  });
});

describe('closing off an entry control', () => {
  it('never closes one when playing alone', () => {
    expect(blocked(null, 'recordPlay')).toBe(false);
  });

  it('closes what the room would refuse', () => {
    expect(blocked(room({ can: () => false }), 'recordPlay')).toBe(true);
  });

  it('closes while the last request is still out', () => {
    expect(blocked(room({ can: () => true, sending: true }), 'recordPlay')).toBe(true);
  });

  it('asks about the action it was given', () => {
    const can = vi.fn().mockReturnValue(true);
    blocked(room({ can }), 'pass');
    expect(can).toHaveBeenCalledWith('pass');
  });
});

describe('offering a control at all', () => {
  it('offers everything when playing alone', () => {
    expect(allowed(null, 'adjust')).toBe(true);
  });

  it('follows what the room permits', () => {
    expect(allowed(room({ can: () => false }), 'adjust')).toBe(false);
    expect(allowed(room({ can: () => true }), 'adjust')).toBe(true);
  });

  // Unlike blocked: a control is still worth offering while one is in flight.
  it('does not withdraw a control just because a request is out', () => {
    expect(allowed(room({ can: () => true, sending: true }), 'undo')).toBe(true);
  });
});

describe('renaming yourself', () => {
  it('renames the player in your seat', () => {
    const dispatch = vi.fn();
    renameSelf(room({ seatId: 'p2' }), dispatch)('Grace H');
    expect(dispatch).toHaveBeenCalledWith({ type: 'renamePlayer', id: 'p2', name: 'Grace H' });
  });

  it('does nothing for a watcher with no seat', () => {
    const dispatch = vi.fn();
    renameSelf(room({ seatId: null }), dispatch)('Nobody');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does nothing when playing alone', () => {
    const dispatch = vi.fn();
    renameSelf(null, dispatch)('Ada');
    expect(dispatch).not.toHaveBeenCalled();
  });
});
