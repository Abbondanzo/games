import { describe, expect, it } from 'vitest';
import {
  MAX_MEMBERS, connect, createRoom, disconnect, handle, join, roomView,
  type ApplyAction, type Context, type Effect, type RoomState,
} from './roomCore';
import type { ClientMessage, ServerMessage } from './protocol';
import { cricketApply as bindCricket } from './games/cricket';
import type { CricketState } from '../cricket/lib/types';

/** The room runs the real cricket reducer, with ids it mints itself. */
const cricketApply = (): ApplyAction<CricketState> => {
  let n = 0;
  return bindCricket(() => `srv-${n++}`);
};

const ctx = (online: string[] = [], now = 1_000): Context => ({ online, now });

const HOST = { memberId: 'm-host', name: 'Ada' };

function newRoom(): RoomState<CricketState> {
  return createRoom({
    code: 'AB2D',
    game: 'cricket',
    host: HOST,
    snapshot: { players: [], turns: [], currentIndex: 0, variant: 'standard' },
    now: 1_000,
  });
}

/** Adds a guest and returns the room plus their id. */
function withGuest(
  state: RoomState<CricketState>,
  memberId: string,
  name: string,
): RoomState<CricketState> {
  const result = join(state, { memberId, name, now: 1_000 });
  if (!result.ok) throw new Error(`join failed: ${result.code}`);
  return result.state;
}

const act = (
  state: RoomState<CricketState>,
  memberId: string,
  message: ClientMessage,
  apply: ApplyAction<CricketState> = cricketApply(),
  online: string[] = [],
) => handle(state, memberId, message, ctx(online), apply);

const sentTo = (effects: Effect[], to: 'all' | 'member'): ServerMessage[] =>
  effects.filter((e) => e.to === to).map((e) => (e as { message: ServerMessage }).message);

const firstError = (effects: Effect[]) =>
  sentTo(effects, 'member').find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');

/** Drives a room through adding two players, returning the room and their ids. */
function withPlayers(state: RoomState<CricketState>) {
  const apply = cricketApply();
  const out = act(state, HOST.memberId, {
    t: 'action', reqId: 'r1', rev: 0, action: { type: 'addPlayers', names: 'Ada, Grace' },
  }, apply);
  const players = out.state.snapshot.players.map((p) => p.id);
  return { state: out.state, players, apply };
}

describe('creating and joining', () => {
  it('starts at revision zero with the host as the only member', () => {
    const room = newRoom();
    expect(room.rev).toBe(0);
    expect(room.members[HOST.memberId]?.role).toBe('host');
    expect(Object.keys(room.members)).toHaveLength(1);
  });

  it('admits a guest as a player with no seat', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    expect(room.members.m1).toMatchObject({ role: 'player', seatId: null });
  });

  it('refuses a locked room', () => {
    const locked = { ...newRoom(), locked: true };
    expect(join(locked, { memberId: 'm1', name: 'Grace', now: 1 }))
      .toEqual({ ok: false, code: 'room-locked' });
  });

  it('refuses a full room', () => {
    let room = newRoom();
    for (let i = 0; i < MAX_MEMBERS - 1; i++) room = withGuest(room, `m${i}`, `P${i}`);
    expect(join(room, { memberId: 'over', name: 'One too many', now: 1 }))
      .toEqual({ ok: false, code: 'room-full' });
  });
});

describe('connecting', () => {
  it('sends the whole picture to the arriving member and presence to everyone', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { effects } = connect(room, 'm1', ctx(['m-host', 'm1']));

    const welcome = sentTo(effects, 'member')[0];
    expect(welcome).toMatchObject({ t: 'welcome', code: 'AB2D', game: 'cricket', rev: 0 });
    expect(sentTo(effects, 'all')[0]).toMatchObject({ t: 'room' });
  });

  it('closes a socket for someone who is not a member', () => {
    const { effects } = connect(newRoom(), 'nobody', ctx());
    expect(effects).toEqual([{ to: 'close', memberId: 'nobody' }]);
  });

  // Presence is derived from live sockets, never stored, because hibernation
  // destroys anything held in memory.
  it('reports presence from the live socket list', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const view = roomView(room, ctx(['m-host']));
    expect(view.members.find((m) => m.memberId === 'm-host')?.online).toBe(true);
    expect(view.members.find((m) => m.memberId === 'm1')?.online).toBe(false);
  });

  it('keeps a seat when the socket drops', () => {
    let room = withGuest(newRoom(), 'm1', 'Grace');
    const seeded = withPlayers(room);
    room = seeded.state;
    room = act(room, 'm1', { t: 'claimSeat', reqId: 'c1', seatId: seeded.players[0]! }).state;

    const after = disconnect(room, 'm1', ctx([])).state;
    expect(after.members.m1?.seatId).toBe(seeded.players[0]);
  });
});

describe('applying an action', () => {
  it('runs the reducer, bumps the revision and tells everyone who did it', () => {
    const { state, effects } = act(newRoom(), HOST.memberId, {
      t: 'action', reqId: 'r1', rev: 0, action: { type: 'addPlayers', names: 'Ada' },
    });

    expect(state.rev).toBe(1);
    expect(sentTo(effects, 'all')[0]).toMatchObject({
      t: 'state', rev: 1, cause: { memberId: HOST.memberId, actionType: 'addPlayers' },
    });
  });

  it('mints ids itself, so every client agrees on them', () => {
    const { state } = withPlayers(newRoom());
    expect(state.snapshot.players.map((p) => p.id)).toEqual(['srv-0', 'srv-1']);
  });

  // Requests are judged against the snapshot the sender saw, never re-evaluated
  // against a newer one.
  it('refuses a request composed against an older revision, and resyncs', () => {
    const { state } = withPlayers(newRoom());
    const { effects } = act(state, HOST.memberId, {
      t: 'action', reqId: 'r2', rev: 0, action: { type: 'newGame' },
    });

    expect(firstError(effects)?.code).toBe('stale-rev');
    expect(sentTo(effects, 'member').some((m) => m.t === 'state')).toBe(true);
  });

  it('ignores a repeated request id rather than applying it twice', () => {
    const apply = cricketApply();
    const first = act(newRoom(), HOST.memberId, {
      t: 'action', reqId: 'same', rev: 0, action: { type: 'addPlayers', names: 'Ada' },
    }, apply);
    const second = act(first.state, HOST.memberId, {
      t: 'action', reqId: 'same', rev: 1, action: { type: 'addPlayers', names: 'Ada' },
    }, apply);

    expect(second.state.rev).toBe(1);
    expect(second.effects).toEqual([]);
  });

  // A reducer that returns the same object has refused the action.
  it('says nothing when the reducer declines to change anything', () => {
    const { state } = withPlayers(newRoom());
    const { state: after, effects } = act(state, HOST.memberId, {
      t: 'action', reqId: 'r9', rev: state.rev, action: { type: 'undo' },
    });
    expect(after.rev).toBe(state.rev);
    expect(effects).toEqual([]);
  });

  it('refuses a state too large to store', () => {
    const bloat: ApplyAction<CricketState> = (state) => ({
      ...state,
      players: [{ id: 'x'.repeat(70_000), name: 'Big', joinedAtTurn: 0 }],
    });
    const { effects } = act(newRoom(), HOST.memberId, {
      t: 'action', reqId: 'r1', rev: 0, action: { type: 'addPlayers', names: 'Ada' },
    }, bloat);
    expect(firstError(effects)?.code).toBe('too-large');
  });

  it('closes the socket of a stranger', () => {
    const { effects } = act(newRoom(), 'ghost', {
      t: 'action', reqId: 'r1', rev: 0, action: { type: 'newGame' },
    });
    expect(effects).toEqual([{ to: 'close', memberId: 'ghost' }]);
  });
});

describe('permissions at the boundary', () => {
  it('refuses a guest a host-only action', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { state, effects } = act(room, 'm1', {
      t: 'action', reqId: 'r1', rev: 0, action: { type: 'newGame' },
    });
    expect(firstError(effects)?.code).toBe('host-only');
    expect(state.rev).toBe(0);
  });

  it('refuses a seated guest a turn that is not theirs', () => {
    const seeded = withPlayers(withGuest(newRoom(), 'm1', 'Grace'));
    let room = act(seeded.state, 'm1', { t: 'claimSeat', reqId: 'c1', seatId: seeded.players[1]! }).state;

    const { effects } = act(room, 'm1', {
      t: 'action', reqId: 'r5', rev: room.rev, action: { type: 'recordTurn', darts: [] },
    }, seeded.apply);
    expect(firstError(effects)?.code).toBe('not-your-turn');
  });

  it('lets a seated guest act on their own turn', () => {
    const seeded = withPlayers(withGuest(newRoom(), 'm1', 'Grace'));
    let room = act(seeded.state, 'm1', { t: 'claimSeat', reqId: 'c1', seatId: seeded.players[0]! }).state;

    const { state } = act(room, 'm1', {
      t: 'action',
      reqId: 'r5',
      rev: room.rev,
      action: { type: 'recordTurn', darts: [{ target: 20, multiplier: 3 }] },
    }, seeded.apply);
    expect(state.rev).toBe(room.rev + 1);
  });
});

describe('seats', () => {
  it('gives the seat to whoever asks first', () => {
    const seeded = withPlayers(withGuest(withGuest(newRoom(), 'm1', 'Grace'), 'm2', 'Alan'));
    const seat = seeded.players[0]!;

    let room = act(seeded.state, 'm1', { t: 'claimSeat', reqId: 'c1', seatId: seat }).state;
    const second = act(room, 'm2', { t: 'claimSeat', reqId: 'c2', seatId: seat });

    expect(firstError(second.effects)?.code).toBe('seat-taken');
    expect(second.state.members.m1?.seatId).toBe(seat);
    expect(second.state.members.m2?.seatId).toBeNull();
  });

  it('refuses a seat that is not a player in the game', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { effects } = act(room, 'm1', { t: 'claimSeat', reqId: 'c1', seatId: 'nobody' });
    expect(firstError(effects)?.code).toBe('not-your-seat');
  });

  it('lets someone give a seat back', () => {
    const seeded = withPlayers(withGuest(newRoom(), 'm1', 'Grace'));
    let room = act(seeded.state, 'm1', { t: 'claimSeat', reqId: 'c1', seatId: seeded.players[0]! }).state;
    room = act(room, 'm1', { t: 'claimSeat', reqId: 'c2', seatId: null }).state;
    expect(room.members.m1?.seatId).toBeNull();
  });

  // Seats are derived from the game after every change, so they cannot drift.
  it('unseats whoever held a player the host has removed', () => {
    const seeded = withPlayers(withGuest(newRoom(), 'm1', 'Grace'));
    let room = act(seeded.state, 'm1', { t: 'claimSeat', reqId: 'c1', seatId: seeded.players[0]! }).state;
    expect(room.members.m1?.seatId).toBe(seeded.players[0]);

    const out = act(room, HOST.memberId, {
      t: 'action',
      reqId: 'r7',
      rev: room.rev,
      action: { type: 'removePlayer', id: seeded.players[0]! },
    }, seeded.apply);

    expect(out.state.members.m1?.seatId).toBeNull();
    expect(sentTo(out.effects, 'all').some((m) => m.t === 'room')).toBe(true);
  });
});

describe('host controls', () => {
  it('locks and unlocks the room', () => {
    const room = act(newRoom(), HOST.memberId, { t: 'lock', locked: true }).state;
    expect(room.locked).toBe(true);
    expect(join(room, { memberId: 'x', name: 'Late', now: 1 }).ok).toBe(false);
  });

  it('refuses a guest the lock', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { effects } = act(room, 'm1', { t: 'lock', locked: true });
    expect(firstError(effects)?.code).toBe('host-only');
  });

  // Kicking without locking is theatre - they would rejoin with a fresh id.
  it('locks the room when kicking, and closes the socket', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { state, effects } = act(room, HOST.memberId, { t: 'kick', memberId: 'm1' });

    expect(state.members.m1).toBeUndefined();
    expect(state.locked).toBe(true);
    expect(effects).toContainEqual({ to: 'close', memberId: 'm1' });
    expect(join(state, { memberId: 'm1-again', name: 'Grace', now: 1 }).ok).toBe(false);
  });

  it('will not let the host kick themselves', () => {
    const { effects } = act(newRoom(), HOST.memberId, { t: 'kick', memberId: HOST.memberId });
    expect(firstError(effects)?.code).toBe('host-only');
  });

  it('renames a member for everyone', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { state } = act(room, 'm1', { t: 'setName', name: 'Grace H' });
    expect(state.members.m1?.name).toBe('Grace H');
  });
});

describe('activity', () => {
  it('records the time of the last message, for idle expiry', () => {
    const room = newRoom();
    const { state } = handle(
      room, HOST.memberId, { t: 'lock', locked: true }, ctx([], 9_999), cricketApply(),
    );
    expect(state.lastActiveAt).toBe(9_999);
  });
});
