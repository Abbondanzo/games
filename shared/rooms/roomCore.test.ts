import { describe, expect, it } from 'vitest';
import {
  MAX_MEMBERS,
  claimable,
  connect,
  createRoom,
  disconnect,
  handle,
  join,
  roomView,
  type ApplyAction,
  type Context,
  type Effect,
  type RoomState,
} from './roomCore';
import type { ClientMessage, ServerMessage } from './protocol';
import { cricketApply as bindCricket, cricketInitialState } from './games/cricket';
import { rummikubApply as bindRummikub, rummikubInitialState } from './games/rummikub';
import { CricketStateSchema } from '../games/cricket/schema';
import type { Snapshot } from './protocol';

/**
 * The room runs the real cricket reducer, with ids it mints itself. The counter
 * is shared across instances: a per-instance one restarts at zero, so two
 * reducers in the same room could mint the same id.
 */
let serverIds = 0;
const cricketApply = (): ApplyAction<Snapshot> => bindCricket(() => `srv-${serverIds++}`);

/** Reads the opaque snapshot back as a real cricket state. */
const asCricket = (snapshot: Snapshot) => CricketStateSchema.parse(snapshot);

const ctx = (online: string[] = [], now = 1_000): Context => ({ online, now });

const HOST = { memberId: 'm-host', name: 'Host' };

/** The host is seated on creation, so a room starts with them in the game. */
function newRoom(apply: ApplyAction<Snapshot> = cricketApply()): RoomState<Snapshot> {
  return createRoom({
    code: 'AB2D',
    game: 'cricket',
    host: HOST,
    snapshot: cricketInitialState(),
    now: 1_000,
    apply,
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
  sentTo(effects, 'member').find(
    (m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error',
  );

/** Drives a room through adding two players, returning the room and their ids. */
function withPlayers(state: RoomState<Snapshot>, apply: ApplyAction<Snapshot> = cricketApply()) {
  const out = act(
    state,
    HOST.memberId,
    {
      t: 'action',
      reqId: 'r1',
      rev: state.rev,
      action: { type: 'addPlayers', names: 'Ada, Grace' },
    },
    apply,
  );
  const players = asCricket(out.state.snapshot).players.map((p) => p.id);
  return { state: out.state, players, apply };
}

describe('creating and joining', () => {
  // The host names themselves when they start the room, so they are a player
  // from the outset rather than a spectator who has to be added.
  it('seats the host as a player when the room is made', () => {
    const room = newRoom();
    const players = asCricket(room.snapshot).players;

    expect(players.map((p) => p.name)).toEqual(['Host']);
    expect(room.members[HOST.memberId]).toMatchObject({ role: 'host', seatId: players[0]!.id });
    expect(room.rev).toBe(1);
  });

  // Someone who types their name is here to play, so joining puts them in the
  // game rather than in a queue for the host's attention.
  it('adds the joiner to the game and seats them', () => {
    const apply = cricketApply();
    const room = withGuest(newRoom(apply), 'm1', 'Grace', apply);
    const players = asCricket(room.snapshot).players;

    expect(players.map((p) => p.name)).toEqual(['Host', 'Grace']);
    expect(room.members.m1?.seatId).toBe(players[1]!.id);
    expect(room.rev).toBe(2);
  });

  /**
   * A name buys nothing. The room used to hand back an unclaimed player of the
   * same name, which meant anyone could take anyone's by typing it, and which
   * did not work for the case it was there for: two people called Peter.
   * Recognising somebody is the device, and only the device.
   */
  it('gives a name it has seen before a new player, not the old one', () => {
    const apply = cricketApply();
    let room = withGuest(newRoom(apply), 'm1', 'Grace', apply);
    const seat = room.members.m1!.seatId;

    room = act(room, 'm1', { t: 'leave', reqId: 'l1' }, apply).state;
    room = withGuest(room, 'm2', 'Grace', apply);

    expect(asCricket(room.snapshot).players.map((p) => p.name)).toEqual([
      'Host',
      'Grace',
      'Grace 2',
    ]);
    expect(room.members.m2?.seatId).not.toBe(seat);
  });

  // A host typing the roster out in advance no longer has people claim those
  // rows: they arrive as themselves, and the host can remove the spares.
  it('does not let a joiner take a player the host typed for them', () => {
    const apply = cricketApply();
    let room = newRoom(apply);
    room = act(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r1',
        rev: room.rev,
        action: { type: 'addPlayers', names: 'Grace' },
      },
      apply,
    ).state;

    room = withGuest(room, 'm1', 'Grace', apply);
    expect(asCricket(room.snapshot).players.map((p) => p.name)).toEqual([
      'Host',
      'Grace',
      'Grace 2',
    ]);
  });

  it('tells everyone already here that a player arrived', () => {
    const apply = cricketApply();
    const result = join(newRoom(), { memberId: 'm1', name: 'Grace', now: 1 }, apply);
    if (!result.ok) throw new Error('join refused');
    expect(result.effects.map((e) => e.to)).toEqual(['all']);
  });

  // Two players called Grace would be indistinguishable on the scoreboard.
  it('numbers a second joiner whose name is already in use', () => {
    const apply = cricketApply();
    let room = withGuest(newRoom(apply), 'm1', 'Grace', apply);
    room = withGuest(room, 'm2', 'Grace', apply);
    expect(asCricket(room.snapshot).players.map((p) => p.name)).toEqual([
      'Host',
      'Grace',
      'Grace 2',
    ]);
  });

  it('refuses a locked room', () => {
    const locked = { ...newRoom(), locked: true };
    expect(join(locked, { memberId: 'm1', name: 'Grace', now: 1 }, cricketApply())).toEqual({
      ok: false,
      code: 'room-locked',
    });
  });

  it('refuses a full room', () => {
    let room = newRoom();
    for (let i = 0; i < MAX_MEMBERS - 1; i++) room = withGuest(room, `m${i}`, `P${i}`);
    expect(join(room, { memberId: 'over', name: 'One too many', now: 1 }, cricketApply())).toEqual({
      ok: false,
      code: 'room-full',
    });
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
    const apply = cricketApply();
    const room = newRoom(apply);
    const { state, effects } = act(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r1',
        rev: room.rev,
        action: { type: 'addPlayers', names: 'Ada' },
      },
      apply,
    );

    expect(state.rev).toBe(room.rev + 1);
    expect(sentTo(effects, 'all')[0]).toMatchObject({
      t: 'state',
      rev: state.rev,
      cause: { memberId: HOST.memberId, actionType: 'addPlayers' },
    });
  });

  it('mints ids itself, so every client agrees on them', () => {
    const { state } = withPlayers(newRoom());
    const ids = asCricket(state.snapshot).players.map((p) => p.id);
    expect(ids.every((id) => id.startsWith('srv-'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Requests are judged against the snapshot the sender saw, never re-evaluated
  // against a newer one.
  it('refuses a request composed against an older revision, and resyncs', () => {
    const { state } = withPlayers(newRoom());
    const { effects } = act(state, HOST.memberId, {
      t: 'action',
      reqId: 'r2',
      rev: 0,
      action: { type: 'newGame' },
    });

    expect(firstError(effects)?.code).toBe('stale-rev');
    expect(sentTo(effects, 'member').some((m) => m.t === 'state')).toBe(true);
  });

  it('ignores a repeated request id rather than applying it twice', () => {
    const apply = cricketApply();
    const room = newRoom(apply);
    const first = act(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'same',
        rev: room.rev,
        action: { type: 'addPlayers', names: 'Ada' },
      },
      apply,
    );
    const second = act(
      first.state,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'same',
        rev: first.state.rev,
        action: { type: 'addPlayers', names: 'Ada' },
      },
      apply,
    );

    expect(second.state.rev).toBe(first.state.rev);
    expect(second.effects).toEqual([]);
  });

  // A reducer that returns the same object has refused the action.
  it('says nothing when the reducer declines to change anything', () => {
    const { state } = withPlayers(newRoom());
    const { state: after, effects } = act(state, HOST.memberId, {
      t: 'action',
      reqId: 'r9',
      rev: state.rev,
      action: { type: 'undo' },
    });
    expect(after.rev).toBe(state.rev);
    expect(effects).toEqual([]);
  });

  it('refuses a state too large to store', () => {
    const bloat: ApplyAction<Snapshot> = (state) => ({
      ...state,
      players: [{ id: 'x'.repeat(70_000), name: 'Big', joinedAtTurn: 0 }],
    });
    const room = newRoom();
    const { effects } = act(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r1',
        rev: room.rev,
        action: { type: 'addPlayers', names: 'Ada' },
      },
      bloat,
    );
    expect(firstError(effects)?.code).toBe('too-large');
  });

  it('closes the socket of a stranger', () => {
    const { effects } = act(newRoom(), 'ghost', {
      t: 'action',
      reqId: 'r1',
      rev: 1,
      action: { type: 'newGame' },
    });
    expect(effects).toEqual([{ to: 'close', memberId: 'ghost' }]);
  });
});

describe('permissions at the boundary', () => {
  it('refuses a guest a host-only action', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { state, effects } = act(room, 'm1', {
      t: 'action',
      reqId: 'r1',
      rev: room.rev,
      action: { type: 'newGame' },
    });
    expect(firstError(effects)?.code).toBe('host-only');
    expect(state.rev).toBe(room.rev);
  });

  it('refuses a seated guest a turn that is not theirs', () => {
    const apply = cricketApply();
    // Ada is added by the host and is up first; Grace joins and gets her own seat.
    let room = act(
      newRoom(),
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r1',
        rev: 0,
        action: { type: 'addPlayers', names: 'Ada' },
      },
      apply,
    ).state;
    room = withGuest(room, 'm1', 'Grace', apply);

    const { effects } = act(
      room,
      'm1',
      {
        t: 'action',
        reqId: 'r5',
        rev: room.rev,
        action: { type: 'recordTurn', darts: [] },
      },
      apply,
    );
    expect(firstError(effects)?.code).toBe('not-your-turn');
  });

  it('lets a seated guest act on their own turn', () => {
    const apply = cricketApply();
    let room = withGuest(newRoom(apply), 'm1', 'Grace', apply);
    // The host is player one, so hand the turn to Grace before she throws.
    room = act(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'sc',
        rev: room.rev,
        action: { type: 'setCurrent', id: room.members.m1!.seatId! },
      },
      apply,
    ).state;

    const { state } = act(
      room,
      'm1',
      {
        t: 'action',
        reqId: 'r5',
        rev: room.rev,
        action: { type: 'recordTurn', darts: [{ target: 20, multiplier: 3 }] },
      },
      apply,
    );
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

    const out = act(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r7',
        rev: room.rev,
        action: { type: 'removePlayer', id: grace },
      },
      apply,
    );

    expect(out.state.members.m1?.seatId).toBeNull();
    expect(sentTo(out.effects, 'all').some((m) => m.t === 'room')).toBe(true);
  });

  it('leaves them watching rather than dropping them from the room', () => {
    const apply = cricketApply();
    const room = withGuest(newRoom(), 'm1', 'Grace', apply);
    const out = act(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r7',
        rev: room.rev,
        action: { type: 'removePlayer', id: room.members.m1!.seatId! },
      },
      apply,
    );

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
  /**
   * Kicking used to lock the room, because locking was the only thing stopping
   * a rejoin. It is not any more, and throwing one person out should not be a
   * decision about everybody else.
   */
  it('removes the member and closes the socket, without touching the lock', () => {
    const room = withGuest(newRoom(), 'm1', 'Grace');
    const { state, effects } = act(room, HOST.memberId, { t: 'kick', memberId: 'm1' });

    expect(state.members.m1).toBeUndefined();
    expect(state.locked).toBe(false);
    expect(effects).toContainEqual({ to: 'close', memberId: 'm1' });
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
  const rummikubRoom = (rules: ApplyAction<Snapshot>) =>
    createRoom({
      code: 'CD3F',
      game: 'rummikub' as const,
      host: HOST,
      snapshot: rummikubInitialState(),
      now: 1_000,
      apply: rules,
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
    let room = withGuestIn(rummikubRoom(rules), 'm1', 'Grace', rules);
    room = handle(
      room,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r1',
        rev: room.rev,
        action: { type: 'addPlayers', names: 'Ada' },
      },
      ctx(),
      rules,
    ).state;

    // The host is a player as well, so pick these out by name rather than order.
    const roster = room.snapshot.players as { id: string; name: string }[];
    const byName = (name: string) => roster.find((p) => p.name === name)!.id;
    return {
      room,
      players: roster.map((p) => p.id),
      rules,
      grace: byName('Grace'),
      ada: byName('Ada'),
    };
  }

  it('opens a round for the player who went out', () => {
    const { room, ada, rules } = setUp();
    const out = handle(
      room,
      HOST.memberId,
      {
        t: 'roundOpen',
        reqId: 'o1',
        winnerId: ada,
      },
      ctx(),
      rules,
    );
    expect(out.state.pending).toEqual({ winnerId: ada, racks: {} });
  });

  it('refuses to open a round for someone who is not playing', () => {
    const { room, rules } = setUp();
    const out = handle(
      room,
      HOST.memberId,
      {
        t: 'roundOpen',
        reqId: 'o1',
        winnerId: 'ghost',
      },
      ctx(),
      rules,
    );
    expect(out.state.pending).toBeNull();
  });

  it('refuses a guest the right to open one', () => {
    const { room, ada, rules } = setUp();
    const out = handle(
      room,
      'm1',
      {
        t: 'roundOpen',
        reqId: 'o1',
        winnerId: ada,
      },
      ctx(),
      rules,
    );
    expect(out.state.pending).toBeNull();
  });

  it('takes a rack from the player it belongs to', () => {
    const { room, grace, ada, rules } = setUp();
    let next = handle(
      room,
      HOST.memberId,
      {
        t: 'roundOpen',
        reqId: 'o1',
        winnerId: ada,
      },
      ctx(),
      rules,
    ).state;

    next = handle(
      next,
      'm1',
      {
        t: 'rackSubmit',
        reqId: 's1',
        seatId: grace,
        total: 24,
      },
      ctx(),
      rules,
    ).state;

    expect(next.pending?.racks).toEqual({ [grace]: 24 });
  });

  it('lets someone correct their own rack before it is committed', () => {
    const { room, grace, ada, rules } = setUp();
    let next = handle(
      room,
      HOST.memberId,
      { t: 'roundOpen', reqId: 'o1', winnerId: ada },
      ctx(),
      rules,
    ).state;
    next = handle(
      next,
      'm1',
      { t: 'rackSubmit', reqId: 's1', seatId: grace, total: 24 },
      ctx(),
      rules,
    ).state;
    next = handle(
      next,
      'm1',
      { t: 'rackSubmit', reqId: 's2', seatId: grace, total: 42 },
      ctx(),
      rules,
    ).state;
    expect(next.pending?.racks[grace]).toBe(42);
  });

  it('refuses a rack submitted for somebody else', () => {
    const { room, grace, ada, rules } = setUp();
    const next = handle(
      room,
      HOST.memberId,
      { t: 'roundOpen', reqId: 'o1', winnerId: grace },
      ctx(),
      rules,
    ).state;
    const out = handle(
      next,
      'm1',
      {
        t: 'rackSubmit',
        reqId: 's1',
        seatId: ada,
        total: 5,
      },
      ctx(),
      rules,
    );
    expect(firstError(out.effects)?.code).toBe('not-your-seat');
  });

  it('refuses a rack when no round is being collected', () => {
    const { room, grace, rules } = setUp();
    const out = handle(
      room,
      'm1',
      {
        t: 'rackSubmit',
        reqId: 's1',
        seatId: grace,
        total: 24,
      },
      ctx(),
      rules,
    );
    expect(firstError(out.effects)?.code).toBe('unknown-action');
  });

  it('clears the collection when the host records the round', () => {
    const { room, grace, ada, rules } = setUp();
    let next = handle(
      room,
      HOST.memberId,
      { t: 'roundOpen', reqId: 'o1', winnerId: ada },
      ctx(),
      rules,
    ).state;
    next = handle(
      next,
      'm1',
      { t: 'rackSubmit', reqId: 's1', seatId: grace, total: 24 },
      ctx(),
      rules,
    ).state;

    const out = handle(
      next,
      HOST.memberId,
      {
        t: 'action',
        reqId: 'r9',
        rev: next.rev,
        action: { type: 'recordRound', winnerId: ada, penalties: { [grace]: 24 } },
      },
      ctx(),
      rules,
    );

    expect(out.state.pending).toBeNull();
    expect((out.state.snapshot.rounds as unknown[]).length).toBe(1);
  });

  it('lets the host abandon a round', () => {
    const { room, ada, rules } = setUp();
    let next = handle(
      room,
      HOST.memberId,
      { t: 'roundOpen', reqId: 'o1', winnerId: ada },
      ctx(),
      rules,
    ).state;
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
      room,
      HOST.memberId,
      { t: 'lock', locked: true },
      ctx([], 9_999),
      cricketApply(),
    );
    expect(state.lastActiveAt).toBe(9_999);
  });
});

/**
 * Recognising a device.
 *
 * Reported from a real table: the host was Peter, Peter joined from a second
 * device and became "Peter 2", left, typed "Peter" to come back - which is the
 * host's name - and became "Peter 3".
 *
 * A name cannot identify anybody. Everyone can see it, anyone can type it, and
 * people rename themselves mid-game. So the room recognises a secret the device
 * holds and nothing else.
 */
describe('coming back to a room', () => {
  const players = (state: RoomState<Snapshot>) =>
    asCricket(state.snapshot).players.map((p) => p.name);

  const leaves = (state: RoomState<Snapshot>, memberId: string) =>
    act(state, memberId, { t: 'leave', reqId: 'r1' }).state;

  const arrive = (
    state: RoomState<Snapshot>,
    memberId: string,
    name: string,
    deviceKey?: string | null,
  ) => join(state, { memberId, name, now: 1, deviceKey }, cricketApply());

  /** The reported table: the host and a second device, both called Peter. */
  const twoPeters = () => {
    const state = createRoom({
      code: 'AB2D',
      game: 'cricket',
      host: { memberId: 'm-host', name: 'Peter', deviceKey: 'host-device' },
      snapshot: cricketInitialState(),
      now: 1_000,
      apply: cricketApply(),
    });
    const second = arrive(state, 'm1', 'Peter', 'phone');
    if (!second.ok) throw new Error(second.code);
    return { state: second.state, seat: second.member.seatId! };
  };

  it('numbers the second Peter, since the first is taken', () => {
    expect(players(twoPeters().state)).toEqual(['Peter', 'Peter 2']);
  });

  it('gives the same player back to the same device', () => {
    const { state, seat } = twoPeters();
    const back = arrive(leaves(state, 'm1'), 'm2', 'Peter', 'phone');

    expect(back.ok && back.member.seatId).toBe(seat);
    expect(back.ok && back.member.name).toBe('Peter 2');
    expect(back.ok && players(back.state)).toEqual(['Peter', 'Peter 2']);
  });

  it('does so whatever name they type, because the name is not the point', () => {
    const { state, seat } = twoPeters();
    const left = leaves(state, 'm1');
    for (const typed of ['Peter', 'peter', 'Somebody Else', '']) {
      const back = arrive(left, 'm2', typed, 'phone');
      expect(back.ok && back.member.seatId, typed).toBe(seat);
    }
  });

  it('makes no new player, so the revision does not move', () => {
    const { state } = twoPeters();
    const left = leaves(state, 'm1');
    const back = arrive(left, 'm2', 'Peter', 'phone');

    expect(back.ok && back.state.rev).toBe(left.rev);
  });

  // This is the bug as reported: a device the room does not recognise.
  it('is a third Peter from a device it has not met', () => {
    const { state } = twoPeters();
    const back = arrive(leaves(state, 'm1'), 'm2', 'Peter', 'another-phone');

    expect(back.ok && players(back.state)).toEqual(['Peter', 'Peter 2', 'Peter 3']);
  });

  it('is a new player for a device that says nothing at all', () => {
    const { state } = twoPeters();
    const back = arrive(leaves(state, 'm1'), 'm2', 'Peter');

    expect(back.ok && players(back.state)).toEqual(['Peter', 'Peter 2', 'Peter 3']);
  });

  /**
   * The security property. A name is public, a player id is in every snapshot,
   * and neither is worth anything here.
   */
  it('cannot be talked into it by name or by player id', () => {
    const { state, seat } = twoPeters();
    const left = leaves(state, 'm1');

    for (const guess of ['Peter 2', seat, 'sha256:phone']) {
      const back = arrive(left, 'm2', 'Peter 2', guess);
      expect(back.ok && back.member.seatId, guess).not.toBe(seat);
    }
  });

  it('will not hand a player to a different device while it is in use', () => {
    const { state, seat } = twoPeters();
    const other = arrive(state, 'm2', 'Peter', 'another-phone');

    expect(other.ok && other.member.seatId).not.toBe(seat);
    expect(other.ok && players(other.state)).toEqual(['Peter', 'Peter 2', 'Peter 3']);
  });

  /**
   * Tapping the invite link while already in the room. This used to make a
   * second player beside a member that would never reconnect, which was a
   * "Grace 2" on the board and, repeated, a room nobody else could get into.
   */
  it('replaces itself rather than arriving twice', () => {
    const { state, seat } = twoPeters();
    const again = arrive(state, 'm2', 'Peter', 'phone');

    expect(again.ok && again.member.seatId).toBe(seat);
    expect(again.ok && players(again.state)).toEqual(['Peter', 'Peter 2']);
  });

  it('drops the member it replaced, and closes its socket', () => {
    const { state } = twoPeters();
    const again = arrive(state, 'm2', 'Peter', 'phone');
    if (!again.ok) throw new Error(again.code);

    expect(again.state.members.m1).toBeUndefined();
    expect(again.state.members.m2).toBeDefined();
    expect(again.effects).toContainEqual({ to: 'close', memberId: 'm1' });
  });

  it('cannot be used to fill the room', () => {
    let state = twoPeters().state;
    for (let i = 0; i < MAX_MEMBERS + 5; i += 1) {
      const again = arrive(state, `rep${i}`, 'Peter', 'phone');
      if (!again.ok) throw new Error(again.code);
      state = again.state;
    }
    // One host, one Peter, however many times they came through the door.
    expect(Object.keys(state.members)).toHaveLength(2);
    expect(players(state)).toEqual(['Peter', 'Peter 2']);
  });

  it('makes a new player when theirs has been taken off the board', () => {
    const { state, seat } = twoPeters();
    const left = leaves(state, 'm1');
    const emptied = act(left, HOST.memberId, {
      t: 'action',
      reqId: 'r2',
      rev: left.rev,
      action: { type: 'removePlayer', id: seat },
    }).state;

    const back = arrive(emptied, 'm2', 'Peter', 'phone');
    expect(back.ok && players(back.state)).toEqual(['Peter', 'Peter 2']);
  });

  it('remembers the host too, so a room can outlive the one who made it', () => {
    const { state } = twoPeters();
    // The host hands over and leaves, which is the only way a host gets out.
    const handed = act(state, HOST.memberId, { t: 'makeHost', reqId: 'r3', memberId: 'm1' }).state;
    const hostSeat = handed.members[HOST.memberId]?.seatId;
    const gone = leaves(handed, HOST.memberId);

    const back = arrive(gone, 'm3', 'Peter', 'host-device');
    expect(back.ok && back.member.seatId).toBe(hostSeat);
  });

  // Nothing a client can read carries one.
  it('keeps device keys out of what the room hands out', () => {
    const { state } = twoPeters();
    const view = JSON.stringify(roomView(state, ctx(['m1'])));

    expect(view).not.toContain('phone');
    expect(view).not.toContain('host-device');
    expect(view).not.toContain('device');
  });
});

/**
 * Locking stops new players, which is not the same as stopping people. A host
 * locks the room once everyone is at the table, and that is exactly when
 * somebody's phone goes to sleep.
 */
describe('coming back to a locked room', () => {
  const lock = (state: RoomState<Snapshot>) =>
    act(state, HOST.memberId, { t: 'lock', locked: true }).state;

  const leaves = (state: RoomState<Snapshot>, memberId: string) =>
    act(state, memberId, { t: 'leave', reqId: 'r1' }).state;

  const arrive = (
    state: RoomState<Snapshot>,
    memberId: string,
    name: string,
    deviceKey?: string | null,
  ) => join(state, { memberId, name, now: 1, deviceKey }, cricketApply());

  const withGrace = () => {
    const room = newRoom();
    const joined = arrive(room, 'm1', 'Grace', 'phone');
    if (!joined.ok) throw new Error(joined.code);
    return { state: joined.state, seat: joined.member.seatId! };
  };

  it('lets a device it knows take its player back', () => {
    const { state, seat } = withGrace();
    const back = arrive(leaves(lock(state), 'm1'), 'm2', 'Grace', 'phone');

    expect(back.ok).toBe(true);
    expect(back.ok && back.member.seatId).toBe(seat);
  });

  it('still turns away a device it does not know', () => {
    const { state } = withGrace();
    const back = arrive(lock(state), 'm2', 'Alan', 'another-phone');

    expect(back.ok).toBe(false);
    expect(!back.ok && back.code).toBe('room-locked');
  });

  it('turns away a device with no secret at all', () => {
    const { state } = withGrace();
    expect(arrive(lock(state), 'm2', 'Alan').ok).toBe(false);
  });

  // Rooms made before any of this have no device list, and must still work.
  it('copes with a room that predates all of it', () => {
    const { state } = withGrace();
    const old = { ...leaves(lock(state), 'm1') } as Partial<RoomState<Snapshot>>;
    delete old.devices;

    const back = arrive(old as RoomState<Snapshot>, 'm2', 'Grace', 'phone');
    expect(back.ok).toBe(false);
    expect(!back.ok && back.code).toBe('room-locked');
  });
});

/**
 * Being removed, which is about a device and nothing else.
 *
 * It used to work by locking the room, so it was tangled up with a decision
 * about everybody else, and unlocking quietly undid it. Now it is written down
 * against the device and lasts the game, until the host says otherwise.
 */
describe('being removed from a game', () => {
  const players = (state: RoomState<Snapshot>) =>
    asCricket(state.snapshot).players.map((p) => p.name);

  const arrive = (
    state: RoomState<Snapshot>,
    memberId: string,
    name: string,
    deviceKey?: string | null,
    claim?: string | null,
  ) => join(state, { memberId, name, now: 1, deviceKey, claim }, cricketApply());

  const withGrace = () => {
    const joined = arrive(newRoom(), 'm1', 'Grace', 'phone');
    if (!joined.ok) throw new Error(joined.code);
    return { state: joined.state, seat: joined.member.seatId! };
  };

  const kick = (state: RoomState<Snapshot>, memberId = 'm1') =>
    act(state, HOST.memberId, { t: 'kick', memberId }).state;

  it('turns that device away', () => {
    const back = arrive(kick(withGrace().state), 'm2', 'Grace', 'phone');
    expect(back.ok).toBe(false);
    expect(!back.ok && back.code).toBe('kicked-out');
  });

  it('still turns it away after the host unlocks the room', () => {
    let state = kick(withGrace().state);
    state = act(state, HOST.memberId, { t: 'lock', locked: true }).state;
    state = act(state, HOST.memberId, { t: 'lock', locked: false }).state;

    expect(arrive(state, 'm2', 'Grace', 'phone').ok).toBe(false);
  });

  it('leaves their player on the board, and nobody else can take it', () => {
    const { state, seat } = withGrace();
    const kicked = kick(state);

    expect(players(kicked)).toEqual(['Host', 'Grace']);
    expect(claimable(kicked).map((p) => p.id)).not.toContain(seat);
  });

  // The host is shown who they have thrown out, by name and by a handle that
  // is not the device key.
  it('shows the host who they removed', () => {
    const view = roomView(kick(withGrace().state), ctx(), true);
    expect(view.removed).toEqual([{ ref: 'm1', name: 'Grace' }]);
  });

  /**
   * And nobody else. It names people who were thrown out, to a table the host
   * did not choose to tell. The UI hiding it is presentation; this is the rule.
   */
  it('tells nobody else', () => {
    expect(roomView(kick(withGrace().state), ctx()).removed).toEqual([]);
  });

  /** The room frame aimed at one member, as opposed to the broadcast. */
  const roomFrameFor = (effects: Effect[], memberId: string) => {
    const found = effects.find(
      (e) =>
        e.to === 'member' &&
        e.memberId === memberId &&
        (e as { message: ServerMessage }).message.t === 'room',
    ) as { message: ServerMessage } | undefined;
    return found?.message;
  };

  it('reaches the host on the wire, and only the host', () => {
    const { state } = withGrace();
    const withAlan = arrive(state, 'm3', 'Alan', 'his-phone');
    if (!withAlan.ok) throw new Error(withAlan.code);
    const { effects } = act(withAlan.state, HOST.memberId, { t: 'kick', memberId: 'm3' });

    // What everybody gets names nobody.
    expect(sentTo(effects, 'all').find((m) => m.t === 'room')).toMatchObject({
      room: { removed: [] },
    });
    // What the host gets names Alan.
    expect(roomFrameFor(effects, HOST.memberId)).toMatchObject({
      room: { removed: [{ ref: 'm3', name: 'Alan' }] },
    });
  });

  it('goes with the room when it is handed over', () => {
    const withAlan = arrive(withGrace().state, 'm3', 'Alan', 'his-phone');
    if (!withAlan.ok) throw new Error(withAlan.code);
    // Grace is removed, then the room is handed to Alan.
    const kicked = kick(withAlan.state);
    const { effects } = act(kicked, HOST.memberId, {
      t: 'makeHost',
      reqId: 'r1',
      memberId: 'm3',
    });

    expect(roomFrameFor(effects, 'm3')).toMatchObject({ room: { removed: [{ name: 'Grace' }] } });
  });

  it('says nothing about it in what the room hands out', () => {
    const view = JSON.stringify(roomView(kick(withGrace().state), ctx()));
    expect(view).not.toContain('phone');
    expect(view).not.toContain('sha256');
  });

  it('lets the host change their mind', () => {
    const { state, seat } = withGrace();
    const kicked = kick(state);
    const forgiven = act(kicked, HOST.memberId, { t: 'allowBack', reqId: 'r1', ref: 'm1' }).state;

    expect(roomView(forgiven, ctx()).removed).toEqual([]);
    const back = arrive(forgiven, 'm2', 'Grace', 'phone');
    // And their own player is waiting, since it was never given away.
    expect(back.ok && back.member.seatId).toBe(seat);
  });

  it("is the host's alone to undo", () => {
    const { state } = withGrace();
    const kicked = kick(state);
    const guest = withGuest(kicked, 'm3', 'Alan');
    const { effects } = act(guest, 'm3', { t: 'allowBack', reqId: 'r1', ref: 'm1' });

    expect(firstError(effects)?.code).toBe('host-only');
  });

  it('shrugs at a handle that means nothing', () => {
    const { effects } = act(kick(withGrace().state), HOST.memberId, {
      t: 'allowBack',
      reqId: 'r1',
      ref: 'nobody',
    });
    expect(firstError(effects)?.code).toBe('unknown-action');
  });

  // Clearing storage makes a new device, and the host can remove that too.
  it('does not stop them coming back as somebody new', () => {
    const back = arrive(kick(withGrace().state), 'm2', 'Grace', 'another-phone');
    expect(back.ok).toBe(true);
    expect(back.ok && players(back.state)).toEqual(['Host', 'Grace', 'Grace 2']);
  });
});

/**
 * Claiming a row the host laid out before anyone arrived.
 *
 * The host types "Ada, Grace" while setting up, and those rows are meant to be
 * taken - that is what they are for. The line is that a row some device already
 * answers for is not on offer to anybody.
 */
describe('claiming a player set up in advance', () => {
  const players = (state: RoomState<Snapshot>) =>
    asCricket(state.snapshot).players.map((p) => p.name);

  const arrive = (
    state: RoomState<Snapshot>,
    memberId: string,
    name: string,
    deviceKey?: string | null,
    claim?: string | null,
  ) => join(state, { memberId, name, now: 1, deviceKey, claim }, cricketApply());

  /** A host who typed the table out before anyone turned up. */
  const laidOut = () => {
    const room = newRoom();
    const state = act(room, HOST.memberId, {
      t: 'action',
      reqId: 'r1',
      rev: room.rev,
      action: { type: 'addPlayers', names: 'Ada, Grace' },
    }).state;
    const seats = asCricket(state.snapshot).players;
    return { state, ada: seats[1]!.id, grace: seats[2]!.id };
  };

  it('offers the rows the host typed, and not the host', () => {
    const { state, ada, grace } = laidOut();
    expect(claimable(state).map((p) => p.id)).toEqual([ada, grace]);
  });

  it('takes the row rather than making another', () => {
    const { state, grace } = laidOut();
    const joined = arrive(state, 'm1', 'Grace', 'phone', grace);

    expect(joined.ok && joined.member.seatId).toBe(grace);
    expect(joined.ok && players(joined.state)).toEqual(['Host', 'Ada', 'Grace']);
  });

  it("is that device's from then on, and nobody else's", () => {
    const { state, grace } = laidOut();
    const taken = arrive(state, 'm1', 'Grace', 'phone', grace);
    if (!taken.ok) throw new Error(taken.code);

    expect(claimable(taken.state).map((p) => p.id)).not.toContain(grace);
    // Even once they have gone, it stays theirs.
    const left = act(taken.state, 'm1', { t: 'leave', reqId: 'l1' }).state;
    expect(claimable(left).map((p) => p.id)).not.toContain(grace);
  });

  it('will not hand a claimed row to somebody else who asks for it', () => {
    const { state, grace } = laidOut();
    const taken = arrive(state, 'm1', 'Grace', 'phone', grace);
    if (!taken.ok) throw new Error(taken.code);
    const left = act(taken.state, 'm1', { t: 'leave', reqId: 'l1' }).state;

    const thief = arrive(left, 'm2', 'Grace', 'another-phone', grace);
    expect(thief.ok && thief.member.seatId).not.toBe(grace);
    expect(thief.ok && players(thief.state)).toEqual(['Host', 'Ada', 'Grace', 'Grace 2']);
  });

  it("will not hand over the host's own player", () => {
    const { state } = laidOut();
    const hostSeat = state.members[HOST.memberId]!.seatId!;
    const thief = arrive(state, 'm1', 'Host', 'phone', hostSeat);

    expect(thief.ok && thief.member.seatId).not.toBe(hostSeat);
  });

  it('falls back to a new player when the row has gone', () => {
    const { state, grace } = laidOut();
    const removed = act(state, HOST.memberId, {
      t: 'action',
      reqId: 'r2',
      rev: state.rev,
      action: { type: 'removePlayer', id: grace },
    }).state;

    const joined = arrive(removed, 'm1', 'Grace', 'phone', grace);
    expect(joined.ok && players(joined.state)).toEqual(['Host', 'Ada', 'Grace']);
  });

  it('gets into a locked room, since it makes no new player', () => {
    const { state, grace } = laidOut();
    const locked = act(state, HOST.memberId, { t: 'lock', locked: true }).state;

    expect(arrive(locked, 'm1', 'Grace', 'phone', grace).ok).toBe(true);
  });

  it('is refused to a device the host removed', () => {
    const { state, ada, grace } = laidOut();
    const joined = arrive(state, 'm1', 'Grace', 'phone', grace);
    if (!joined.ok) throw new Error(joined.code);
    const kicked = act(joined.state, HOST.memberId, { t: 'kick', memberId: 'm1' }).state;

    // Not even a different row, and not by claiming one.
    expect(arrive(kicked, 'm2', 'Ada', 'phone', ada).ok).toBe(false);
  });

  /**
   * Occupancy cannot depend on the client having cooperated. A member seated
   * without a device key leaves no entry in `devices`, and their player would
   * otherwise fall back into the claimable list the moment they left.
   */
  it('does not offer a row somebody held without a device key', () => {
    const { state, grace } = laidOut();
    const taken = arrive(state, 'm1', 'Grace', null, grace);
    if (!taken.ok) throw new Error(taken.code);
    const left = act(taken.state, 'm1', { t: 'leave', reqId: 'l1' }).state;

    expect(claimable(left).map((p) => p.id)).not.toContain(grace);
    const thief = arrive(left, 'm2', 'Grace', 'phone', grace);
    expect(thief.ok && thief.member.seatId).not.toBe(grace);
  });

  it('remembers the device, so leaving and returning still works', () => {
    const { state, grace } = laidOut();
    const taken = arrive(state, 'm1', 'Grace', 'phone', grace);
    if (!taken.ok) throw new Error(taken.code);
    const left = act(taken.state, 'm1', { t: 'leave', reqId: 'l1' }).state;

    // No claim this time: the device is enough.
    const back = arrive(left, 'm2', 'Whatever', 'phone');
    expect(back.ok && back.member.seatId).toBe(grace);
  });
});
