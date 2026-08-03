import { describe, expect, it } from 'vitest';
import {
  MAX_MEMBERS, connect, createRoom, disconnect, handle, join, roomView,
  type ApplyAction, type Context, type Effect, type RoomState,
} from './roomCore';
import type { ClientMessage, ServerMessage } from './protocol';
import { cricketApply as bindCricket, cricketInitialState } from './games/cricket';
import { rummikubApply as bindRummikub, rummikubInitialState } from './games/rummikub';
import { CricketStateSchema } from '../games/cricket/schema';
import type { Snapshot } from './protocol';

/** The room runs the real cricket reducer, with ids it mints itself. */
const cricketApply = (): ApplyAction<Snapshot> => {
  let n = 0;
  return bindCricket(() => `srv-${n++}`);
};

/** Reads the opaque snapshot back as a real cricket state. */
const asCricket = (snapshot: Snapshot) => CricketStateSchema.parse(snapshot);

const ctx = (online: string[] = [], now = 1_000): Context => ({ online, now });

const HOST = { memberId: 'm-host', name: 'Ada' };

function newRoom(): RoomState<Snapshot> {
  return createRoom({
    code: 'AB2D',
    game: 'cricket',
    host: HOST,
    snapshot: cricketInitialState(),
    now: 1_000,
  });
}

/** Adds a guest to any room, whatever the game. */
function withGuestIn(
  state: RoomState<Snapshot>,
  memberId: string,
  name: string,
  apply: ApplyAction<Snapshot> = cricketApply(),
): RoomState<Snapshot> {
  const result = join(state, { memberId, name, now: 1_000 }, apply);
  if (!result.ok) throw new Error(`join failed: ${result.code}`);
  return result.state;
}

/** Adds a guest and returns the room plus their id. */
function withGuest(
  state: RoomState<Snapshot>,
  memberId: string,
  name: string,
  apply: ApplyAction<Snapshot> = cricketApply(),
): RoomState<Snapshot> {
  const result = join(state, { memberId, name, now: 1_000 }, apply);
  if (!result.ok) throw new Error(`join failed: ${result.code}`);
  return result.state;
}

const act = (
  state: RoomState<Snapshot>,
  memberId: string,
  message: ClientMessage,
  apply: ApplyAction<Snapshot> = cricketApply(),
  online: string[] = [],
) => handle(state, memberId, message, ctx(online), apply);

const sentTo = (effects: Effect[], to: 'all' | 'member'): ServerMessage[] =>
  effects.filter((e) => e.to === to).map((e) => (e as { message: ServerMessage }).message);

const firstError = (effects: Effect[]) =>
  sentTo(effects, 'member').find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');

/** Drives a room through adding two players, returning the room and their ids. */
function withPlayers(state: RoomState<Snapshot>) {
  const apply = cricketApply();
  const out = act(state, HOST.memberId, {
    t: 'action', reqId: 'r1', rev: 0, action: { type: 'addPlayers', names: 'Ada, Grace' },
  }, apply);
  const players = asCricket(out.state.snapshot).players.map((p) => p.id);
  return { state: out.state, players, apply };
}

describe('creating and joining', () => {
  it('starts at revision zero with the host as the only member', () => {
    const room = newRoom();
    expect(room.rev).toBe(0);
    expect(room.members[HOST.memberId]?.role).toBe('host');
    expect(Object.keys(room.members)).toHaveLength(1);
  });

  // Someone who types their name is here to play, so joining puts them in the
  // game rather than in a queue for the host's attention.
  it('adds the joiner to the game and seats them', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const players = asCricket(room.snapshot).players;

    expect(players.map((p) => p.name)).toEqual(['Grace']);
    expect(room.members.m1?.seatId).toBe(players[0]!.id);
    expect(room.rev).toBe(1);
  });

  it('tells everyone already here that a player arrived', () => {
    const apply = cricketApply();
    const result = join(newRoom(), { memberId: 'm1', name: 'Grace', now: 1 }, apply);
    if (!result.ok) throw new Error('join refused');
    expect(result.effects.map((e) => e.to)).toEqual(['all']);
  });

  // Two players called Grace would be indistinguishable on the scoreboard.
  it('numbers a joiner whose name is already taken', () => {
    const apply = cricketApply();
    let room = withGuest(newRoom(), 'm1', 'Grace', apply);
    room = withGuest(room, 'm2', 'Grace', apply);
    expect(asCricket(room.snapshot).players.map((p) => p.name)).toEqual(['Grace', 'Grace 2']);
  });

  it('refuses a locked room', () => {
    const locked = { ...newRoom(), locked: true };
    expect(join(locked, { memberId: 'm1', name: 'Grace', now: 1 }, cricketApply()))
      .toEqual({ ok: false, code: 'room-locked' });
  });

  it('refuses a full room', () => {
    let room = newRoom();
    for (let i = 0; i < MAX_MEMBERS - 1; i++) room = withGuest(room, `m${i}`, `P${i}`);
    expect(join(room, { memberId: 'over', name: 'One too many', now: 1 }, cricketApply()))
      .toEqual({ ok: false, code: 'room-full' });
  });
});

describe('connecting', () => {
  it('sends the whole picture to the arriving member and presence to everyone', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { effects } = connect(room, 'm1', ctx(['m-host', 'm1']));

    const welcome = sentTo(effects, 'member')[0];
    expect(welcome).toMatchObject({ t: 'welcome', code: 'AB2D', game: 'cricket' });
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
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const seat = room.members.m1?.seatId;

    const after = disconnect(room, 'm1', ctx([])).state;
    expect(after.members.m1?.seatId).toBe(seat);
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
    expect(asCricket(state.snapshot).players.map((p) => p.id)).toEqual(['srv-0', 'srv-1']);
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
    const bloat: ApplyAction<Snapshot> = (state) => ({
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
      t: 'action', reqId: 'r1', rev: room.rev, action: { type: 'newGame' },
    });
    expect(firstError(effects)?.code).toBe('host-only');
    expect(state.rev).toBe(room.rev);
  });

  it('refuses a seated guest a turn that is not theirs', () => {
    const apply = cricketApply();
    // Ada is added by the host and is up first; Grace joins and gets her own seat.
    let room = act(newRoom(), HOST.memberId, {
      t: 'action', reqId: 'r1', rev: 0, action: { type: 'addPlayers', names: 'Ada' },
    }, apply).state;
    room = withGuest(room, 'm1', 'Grace', apply);

    const { effects } = act(room, 'm1', {
      t: 'action', reqId: 'r5', rev: room.rev, action: { type: 'recordTurn', darts: [] },
    }, apply);
    expect(firstError(effects)?.code).toBe('not-your-turn');
  });

  it('lets a seated guest act on their own turn', () => {
    const apply = cricketApply();
    // Grace is the only player, so it is her turn from the start.
    const room = withGuest(newRoom(), 'm1', 'Grace', apply);

    const { state } = act(room, 'm1', {
      t: 'action',
      reqId: 'r5',
      rev: room.rev,
      action: { type: 'recordTurn', darts: [{ target: 20, multiplier: 3 }] },
    }, apply);
    expect(state.rev).toBe(room.rev + 1);
  });
});

describe('seats', () => {
  // Seats are handed out at the door and never chosen, so the only way one
  // changes is the host removing the player. Reconciling from the game after
  // every change means the two cannot drift apart.
  it('unseats whoever held a player the host has removed', () => {
    const apply = cricketApply();
    const room = withGuest(newRoom(), 'm1', 'Grace', apply);
    const grace = room.members.m1!.seatId!;

    const out = act(room, HOST.memberId, {
      t: 'action', reqId: 'r7', rev: room.rev, action: { type: 'removePlayer', id: grace },
    }, apply);

    expect(out.state.members.m1?.seatId).toBeNull();
    expect(sentTo(out.effects, 'all').some((m) => m.t === 'room')).toBe(true);
  });

  it('leaves them watching rather than dropping them from the room', () => {
    const apply = cricketApply();
    const room = withGuest(newRoom(), 'm1', 'Grace', apply);
    const out = act(room, HOST.memberId, {
      t: 'action', reqId: 'r7', rev: room.rev,
      action: { type: 'removePlayer', id: room.members.m1!.seatId! },
    }, apply);

    expect(out.state.members.m1).toBeDefined();
  });
});

describe('host controls', () => {
  // Locking is what stops both joining and the player it would have created.
  it('locks and unlocks the room', () => {
    const room = act(newRoom(), HOST.memberId, { t: 'lock', locked: true }).state;
    expect(room.locked).toBe(true);

    const refused = join(room, { memberId: 'x', name: 'Late', now: 1 }, cricketApply());
    expect(refused).toEqual({ ok: false, code: 'room-locked' });

    const open = act(room, HOST.memberId, { t: 'lock', locked: false }).state;
    expect(join(open, { memberId: 'x', name: 'Late', now: 1 }, cricketApply()).ok).toBe(true);
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
    expect(join(state, { memberId: 'm1-again', name: 'Grace', now: 1 }, cricketApply()).ok).toBe(false);
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

/**
 * A Rummikub round records everyone's rack at once, so it cannot be seat-scoped
 * like a dart or a word. Guests instead submit their own rack into room state,
 * and the host commits the round when they are in. RummikubState never changes.
 */
describe('collecting Rummikub racks', () => {
  const rummikubRoom = () => createRoom({
    code: 'CD3F',
    game: 'rummikub' as const,
    host: HOST,
    snapshot: rummikubInitialState(),
    now: 1_000,
  });

  const apply = () => {
    let n = 0;
    return bindRummikub(() => `srv-${n++}`);
  };

  /**
   * Grace joins, which seats her, and the host types in Ada, who has no phone.
   * Note the room's own reducer has to be threaded through the join, or the
   * player it creates would be built by the wrong game.
   */
  function setUp() {
    const rules = apply();
    let room = withGuestIn(rummikubRoom(), 'm1', 'Grace', rules);
    room = handle(room, HOST.memberId, {
      t: 'action', reqId: 'r1', rev: room.rev, action: { type: 'addPlayers', names: 'Ada' },
    }, ctx(), rules).state;

    const players = (room.snapshot.players as { id: string }[]).map((p) => p.id);
    return { room, players, rules, grace: players[0]!, ada: players[1]! };
  }

  it('opens a round for the player who went out', () => {
    const { room, ada, rules } = setUp();
    const out = handle(room, HOST.memberId, {
      t: 'roundOpen', reqId: 'o1', winnerId: ada,
    }, ctx(), rules);
    expect(out.state.pending).toEqual({ winnerId: ada, racks: {} });
  });

  it('refuses to open a round for someone who is not playing', () => {
    const { room, rules } = setUp();
    const out = handle(room, HOST.memberId, {
      t: 'roundOpen', reqId: 'o1', winnerId: 'ghost',
    }, ctx(), rules);
    expect(out.state.pending).toBeNull();
  });

  it('refuses a guest the right to open one', () => {
    const { room, ada, rules } = setUp();
    const out = handle(room, 'm1', {
      t: 'roundOpen', reqId: 'o1', winnerId: ada,
    }, ctx(), rules);
    expect(out.state.pending).toBeNull();
  });

  it('takes a rack from the player it belongs to', () => {
    const { room, grace, ada, rules } = setUp();
    let next = handle(room, HOST.memberId, {
      t: 'roundOpen', reqId: 'o1', winnerId: ada,
    }, ctx(), rules).state;

    next = handle(next, 'm1', {
      t: 'rackSubmit', reqId: 's1', seatId: grace, total: 24,
    }, ctx(), rules).state;

    expect(next.pending?.racks).toEqual({ [grace]: 24 });
  });

  it('lets someone correct their own rack before it is committed', () => {
    const { room, grace, ada, rules } = setUp();
    let next = handle(room, HOST.memberId, { t: 'roundOpen', reqId: 'o1', winnerId: ada }, ctx(), rules).state;
    next = handle(next, 'm1', { t: 'rackSubmit', reqId: 's1', seatId: grace, total: 24 }, ctx(), rules).state;
    next = handle(next, 'm1', { t: 'rackSubmit', reqId: 's2', seatId: grace, total: 42 }, ctx(), rules).state;
    expect(next.pending?.racks[grace]).toBe(42);
  });

  it('refuses a rack submitted for somebody else', () => {
    const { room, grace, ada, rules } = setUp();
    const next = handle(room, HOST.memberId, { t: 'roundOpen', reqId: 'o1', winnerId: grace }, ctx(), rules).state;
    const out = handle(next, 'm1', {
      t: 'rackSubmit', reqId: 's1', seatId: ada, total: 5,
    }, ctx(), rules);
    expect(firstError(out.effects)?.code).toBe('not-your-seat');
  });

  it('refuses a rack when no round is being collected', () => {
    const { room, grace, rules } = setUp();
    const out = handle(room, 'm1', {
      t: 'rackSubmit', reqId: 's1', seatId: grace, total: 24,
    }, ctx(), rules);
    expect(firstError(out.effects)?.code).toBe('unknown-action');
  });

  it('clears the collection when the host records the round', () => {
    const { room, grace, ada, rules } = setUp();
    let next = handle(room, HOST.memberId, { t: 'roundOpen', reqId: 'o1', winnerId: ada }, ctx(), rules).state;
    next = handle(next, 'm1', { t: 'rackSubmit', reqId: 's1', seatId: grace, total: 24 }, ctx(), rules).state;

    const out = handle(next, HOST.memberId, {
      t: 'action',
      reqId: 'r9',
      rev: next.rev,
      action: { type: 'recordRound', winnerId: ada, penalties: { [grace]: 24 } },
    }, ctx(), rules);

    expect(out.state.pending).toBeNull();
    expect((out.state.snapshot.rounds as unknown[]).length).toBe(1);
  });

  it('lets the host abandon a round', () => {
    const { room, ada, rules } = setUp();
    let next = handle(room, HOST.memberId, { t: 'roundOpen', reqId: 'o1', winnerId: ada }, ctx(), rules).state;
    next = handle(next, HOST.memberId, { t: 'roundCancel', reqId: 'x1' }, ctx(), rules).state;
    expect(next.pending).toBeNull();
  });
});

/**
 * A host has no way to leave. The game lives in the room, so a host walking out
 * would strand it with nobody able to add a player or change the rules. Ending
 * it is the only exit, and it ends it for everyone.
 */
describe('closing a room', () => {
  it('tells everyone and shuts the room down', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { effects } = act(room, HOST.memberId, { t: 'closeRoom', reqId: 'x1' });

    expect(sentTo(effects, 'all')).toContainEqual({ t: 'closed' });
    expect(effects).toContainEqual({ to: 'shutdown' });
  });

  it('is refused to a guest', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { effects } = act(room, 'm1', { t: 'closeRoom', reqId: 'x1' });

    expect(firstError(effects)?.code).toBe('host-only');
    expect(effects.some((e) => e.to === 'shutdown')).toBe(false);
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
