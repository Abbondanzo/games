/**
 * The room, as a pure state machine.
 *
 * Messages in, next state and a list of effects out. It knows nothing about
 * sockets, storage, alarms or Cloudflare, which is what lets the whole protocol
 * be tested in the ordinary test run with no network and no workerd. The
 * Durable Object is a thin adapter over this.
 *
 * The same rule the games already follow - rules live in plain functions - one
 * level up: protocol lives in plain functions.
 */
import type {
  Cause, ErrorCode, Game, GameAction, Member, PendingRound, Role, RoomView, ServerMessage, Snapshot,
} from './protocol';
import { PROTOCOL_VERSION } from './protocol';
import type { ClientMessage } from './protocol';
import { permit, seatView, type Actor } from './permissions';

/** How many people can be in one room. Enough for any table, small enough to bound work. */
export const MAX_MEMBERS = 12;

/**
 * A serialised game state larger than this is refused. Around 500 Scrabble
 * turns: unreachable in a real game, reachable by a hostile client, and the
 * room has a per-value storage limit to stay under.
 */
export const MAX_STATE_BYTES = 64 * 1024;

/** Recent request ids kept per member, to drop double taps and retry duplicates. */
const SEEN_LIMIT = 16;

export interface StoredMember {
  memberId: string;
  name: string;
  role: Role;
  seatId: string | null;
  /**
   * The device behind this member, so removing them can be made to stick.
   * Server-side only: `roomView` names the fields clients get, and this is not
   * one of them.
   */
  deviceKey?: string;
  /** Recent request ids, newest last. */
  seen: string[];
}

export interface RoomState<S extends Snapshot = Snapshot> {
  code: string;
  game: Game;
  /** Bumped on every accepted game action. */
  rev: number;
  snapshot: S;
  members: Record<string, StoredMember>;
  locked: boolean;
  /**
   * Devices the host has removed, for the rest of the game.
   *
   * Keyed on the device rather than on the seat or the name, so it survives
   * everything they could change, and independent of the lock: locking is about
   * whether new people may arrive, and has nothing to say about somebody the
   * host has thrown out. `ref` is the member id they had, a public handle the
   * host can undo them by without the key itself ever leaving the room.
   *
   * Absent on rooms made before this existed, so always read it with `?? {}`.
   */
  kicked?: Record<string, { ref: string; name: string }>;
  /**
   * Which player a device is, keyed by an opaque digest of a secret only that
   * device holds. This is how somebody who leaves gets their player back.
   *
   * It never leaves the room: `roomView` builds what clients see field by
   * field, and none of this is in it. Nothing over the socket carries a device
   * key, and no client behaviour depends on one - a device says who it is once,
   * over HTTPS, when it joins.
   *
   * Absent on rooms made before this existed, so always read it with `?? {}`.
   */
  devices?: Record<string, string>;
  /** A Rummikub round being collected, if one is open. */
  pending: PendingRound | null;
  lastActiveAt: number;
}

/** What the adapter must tell the core, since none of it is derivable here. */
export interface Context {
  /** Member ids with a live socket. Derived from the sockets, never stored. */
  online: readonly string[];
  now: number;
}

/**
 * Validates an action and applies it, or returns null if the action is not
 * something this game accepts.
 *
 * Validation and application are one step on purpose. `permit` only looks at
 * the action's type, so without this a payload like
 * `{ type: 'addPlayers', names: 42 }` would reach the reducer and throw inside
 * the room. The game module narrows the payload before its reducer ever sees it.
 */
export type ApplyAction<S> = (state: S, action: GameAction) => S | null;

export type Effect =
  | { to: 'all'; message: ServerMessage }
  | { to: 'member'; memberId: string; message: ServerMessage }
  | { to: 'close'; memberId: string }
  /** The room is over: drop every socket and delete it. */
  | { to: 'shutdown' };

export interface Outcome<S extends Snapshot = Snapshot> {
  state: RoomState<S>;
  effects: Effect[];
}

/**
 * Players a joiner may say they are.
 *
 * A host who sets the table up before anyone arrives types the names, and those
 * rows are meant to be claimed - that is what they are for. But only those: a
 * player some device already answers for belongs to that device, and no name
 * anybody types can take it away. So a row is claimable exactly while nobody
 * has ever held it, which by construction excludes the host's own.
 */
export function claimable<S extends Snapshot>(state: RoomState<S>): { id: string; name: string }[] {
  const spokenFor = new Set<string>([
    ...Object.values(state.devices ?? {}),
    ...Object.values(state.members).map((m) => m.seatId ?? ''),
  ]);
  return playersIn(state.snapshot).filter((p) => !spokenFor.has(p.id));
}

/* ─────────────────────────── views ─────────────────────────── */

export function roomView<S extends Snapshot>(state: RoomState<S>, ctx: Context): RoomView {
  const online = new Set(ctx.online);
  const members: Member[] = Object.values(state.members).map((m) => ({
    memberId: m.memberId,
    name: m.name,
    role: m.role,
    seatId: m.seatId,
    online: online.has(m.memberId),
  }));
  return {
    members,
    locked: state.locked,
    pending: state.pending,
    removed: Object.values(state.kicked ?? {}).map(({ ref, name }) => ({ ref, name })),
  };
}

const actorOf = (member: StoredMember): Actor => ({
  role: member.role,
  memberId: member.memberId,
  seatId: member.seatId,
});

/* ─────────────────────────── lifecycle ─────────────────────────── */

/**
 * Puts somebody into the game and hands back their seat.
 *
 * Shared by the host at creation and by everyone who joins after, so there is
 * one answer to "how does a person become a player" rather than two that can
 * drift. A player of that name already sitting unclaimed is almost always this
 * person - back after leaving, or typed in by the host in advance - so they
 * take it rather than appearing twice.
 */
/**
 * Whether two names would read as the same on a scoreboard.
 *
 * This is about telling rows apart, not about telling people apart. Nothing in
 * this file recognises anybody by name: identity is `devices`, and only that.
 */
const nameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

/**
 * A new player, for a device the room has not seen before.
 *
 * Deliberately never matches on name. A name is not an identity here: people
 * rename themselves, two of them can want the same one, and anybody can type
 * anybody's. Recognising somebody is `devices` above, and only that.
 */
function seatNewcomer<S extends Snapshot>(
  game: Game,
  snapshot: S,
  wanted: string,
  apply: ApplyAction<S>,
): { snapshot: S; seatId: string | null; name: string } {
  const name = distinctName(wanted, namesIn(snapshot));
  const before = seatView[game](snapshot).playerIds;
  const next = apply(snapshot, { type: 'addPlayers', names: name });

  // If the game will not take the player they are still here, just watching.
  if (!next || next === snapshot) return { snapshot, seatId: null, name };

  const seatId = seatView[game](next).playerIds.find((id) => !before.includes(id)) ?? null;
  return { snapshot: next, seatId, name };
}

export function createRoom<S extends Snapshot>(input: {
  code: string;
  game: Game;
  host: { memberId: string; name: string; deviceKey?: string };
  snapshot: S;
  now: number;
  apply: ApplyAction<S>;
}): RoomState<S> {
  // The host is a player like anyone else, unless they chose not to be named.
  const seated = seatNewcomer(input.game, input.snapshot, input.host.name, input.apply);

  return {
    code: input.code,
    game: input.game,
    rev: seated.snapshot === input.snapshot ? 0 : 1,
    snapshot: seated.snapshot,
    members: {
      [input.host.memberId]: {
        memberId: input.host.memberId,
        name: seated.name,
        role: 'host',
        seatId: seated.seatId,
        ...(input.host.deviceKey ? { deviceKey: input.host.deviceKey } : {}),
        seen: [],
      },
    },
    locked: false,
    // So a host who hands the room over and leaves can come back to their own
    // player, exactly as anybody else does.
    devices: input.host.deviceKey && seated.seatId
      ? { [input.host.deviceKey]: seated.seatId }
      : {},
    pending: null,
    lastActiveAt: input.now,
  };
}

export type JoinResult<S extends Snapshot> =
  | { ok: true; state: RoomState<S>; member: StoredMember; effects: Effect[] }
  | { ok: false; code: ErrorCode };

/**
 * Two people called Grace would be indistinguishable on the scoreboard, so the
 * second becomes "Grace 2". Only joiners are numbered; a host typing the roster
 * can call people whatever they like.
 */
function distinctName(wanted: string, taken: readonly string[]): string {
  const trimmed = wanted.trim() || 'Player';
  const used = (candidate: string) => taken.some((name) => sameName(name, candidate));
  if (!used(trimmed)) return trimmed;
  for (let n = 2; n < 100; n++) {
    const candidate = `${trimmed} ${n}`;
    if (!used(candidate)) return candidate;
  }
  return trimmed;
}

/**
 * Joining adds you to the game, not just to the room.
 *
 * Someone who types their name is here to play, so the room creates the player
 * and seats them in one step. Waiting for the host to add you and then picking
 * yourself off a list is two rounds of coordination for something nobody needs
 * to decide.
 *
 * Locking is therefore what stops both at once: no join, no new player.
 */
export function join<S extends Snapshot>(
  state: RoomState<S>,
  input: {
    memberId: string;
    name: string;
    now: number;
    deviceKey?: string | null;
    /** A player set up in advance that this joiner says is them. */
    claim?: string | null;
  },
  apply: ApplyAction<S>,
): JoinResult<S> {
  if (Object.keys(state.members).length >= MAX_MEMBERS) return { ok: false, code: 'room-full' };

  const devices = state.devices ?? {};

  // Removed by the host, and that is the end of it for this game. Nothing else
  // here can talk its way past this, and unlocking the room does not either.
  if (input.deviceKey && (state.kicked ?? {})[input.deviceKey]) {
    return { ok: false, code: 'kicked-out' };
  }

  const claimed = new Set(Object.values(state.members).map((m) => m.seatId));

  /**
   * The player this device already is.
   *
   * The room recognises a device, never a name. A name cannot identify somebody
   * coming back: a table with two Peters has a "Peter" and a "Peter 2", so the
   * name the second one types on returning is the first one's. And a name is
   * not theirs to prove - everybody can see it, everybody can type it, and
   * people rename themselves mid-game.
   *
   * The key is a digest of a secret only that device holds, so it cannot be
   * guessed from anything the room hands out. Even then it is a request rather
   * than a fact: the player has to still exist and be free.
   */
  const held = input.deviceKey ? devices[input.deviceKey] : undefined;
  const mine = held && !claimed.has(held)
    ? playersIn(state.snapshot).find((p) => p.id === held)
    : undefined;

  /**
   * Or a row the host typed out in advance, which this joiner says is them.
   *
   * There is nothing to verify here and nothing to verify it with: the host
   * wrote "Grace" so that Grace could take it, and the only thing standing
   * between that and a stranger is the room code. What it cannot do is take a
   * player away from a device that already answers for one, which is what
   * `claimable` is for.
   */
  const claiming = !mine && input.claim
    ? claimable(state).find((p) => p.id === input.claim)
    : undefined;

  const taking = mine ?? claiming;
  const seated = taking
    ? { snapshot: state.snapshot, seatId: taking.id, name: taking.name }
    : seatNewcomer(state.game, state.snapshot, input.name, apply);
  const added = seated.snapshot !== state.snapshot;

  /**
   * Locking stops new players, which is not the same as stopping people.
   *
   * A host locks the room once everyone is at the table, and that is exactly
   * when somebody drops their phone in their pocket and comes back to find the
   * door shut on a player that is sitting there with their score on it. So a
   * join that takes an existing player is allowed through - whether coming back
   * or claiming a row the host laid out - and one that would make a new player
   * is not. Somebody the host removed was turned away well before here.
   */
  if (state.locked && added) return { ok: false, code: 'room-locked' };

  const member: StoredMember = {
    memberId: input.memberId,
    name: seated.name,
    role: 'player',
    seatId: seated.seatId,
    ...(input.deviceKey ? { deviceKey: input.deviceKey } : {}),
    seen: [],
  };

  const next: RoomState<S> = {
    ...state,
    snapshot: seated.snapshot,
    rev: added ? state.rev + 1 : state.rev,
    members: { ...state.members, [input.memberId]: member },
    // Remembered whichever way they were seated, so the next time they arrive
    // is a return rather than another new player.
    devices: input.deviceKey && seated.seatId
      ? { ...devices, [input.deviceKey]: seated.seatId }
      : devices,
    lastActiveAt: input.now,
  };

  // Whoever is already connected needs to see the new player arrive.
  const effects: Effect[] = added
    ? [{ to: 'all', message: { t: 'state', rev: next.rev, state: seated.snapshot, cause: null } }]
    : [];

  return { ok: true, member, state: next, effects };
}

/** The players in a snapshot, as far as the room needs to read them. */
function playersIn(snapshot: Snapshot): { id: string; name: string }[] {
  const players = snapshot.players;
  if (!Array.isArray(players)) return [];
  return players.flatMap((p) => {
    if (typeof p !== 'object' || p === null) return [];
    const { id, name } = p as { id?: unknown; name?: unknown };
    return typeof id === 'string' && typeof name === 'string' ? [{ id, name }] : [];
  });
}

/** Player names already in the game, so a joiner does not collide with one. */
const namesIn = (snapshot: Snapshot): string[] => playersIn(snapshot).map((p) => p.name);

/** A socket opened. The joiner gets everything; everyone else gets the presence change. */
export function connect<S extends Snapshot>(
  state: RoomState<S>,
  memberId: string,
  ctx: Context,
): Outcome<S> {
  const member = state.members[memberId];
  if (!member) return { state, effects: [{ to: 'close', memberId }] };

  const welcome: ServerMessage = {
    t: 'welcome',
    protocol: PROTOCOL_VERSION,
    code: state.code,
    game: state.game,
    you: {
      memberId: member.memberId,
      role: member.role,
      seatId: member.seatId,
      name: member.name,
    },
    rev: state.rev,
    state: state.snapshot,
    room: roomView(state, ctx),
  };

  return {
    state: { ...state, lastActiveAt: ctx.now },
    effects: [
      { to: 'member', memberId, message: welcome },
      { to: 'all', message: { t: 'room', room: roomView(state, ctx) } },
    ],
  };
}

/** A socket closed. The member keeps their seat; only their presence changes. */
export function disconnect<S extends Snapshot>(
  state: RoomState<S>,
  _memberId: string,
  ctx: Context,
): Outcome<S> {
  return {
    state,
    effects: [{ to: 'all', message: { t: 'room', room: roomView(state, ctx) } }],
  };
}

/* ─────────────────────────── message handling ─────────────────────────── */

const fail = <S extends Snapshot>(
  state: RoomState<S>,
  memberId: string,
  reqId: string | null,
  code: ErrorCode,
): Outcome<S> => ({
  state,
  effects: [{ to: 'member', memberId, message: { t: 'error', reqId, code } }],
});

const remember = (member: StoredMember, reqId: string): StoredMember => ({
  ...member,
  seen: [...member.seen, reqId].slice(-SEEN_LIMIT),
});

export function handle<S extends Snapshot>(
  state: RoomState<S>,
  memberId: string,
  message: ClientMessage,
  ctx: Context,
  apply: ApplyAction<S>,
): Outcome<S> {
  const member = state.members[memberId];
  if (!member) return { state, effects: [{ to: 'close', memberId }] };

  const touched = { ...state, lastActiveAt: ctx.now };

  switch (message.t) {
    case 'action':
      return handleAction(touched, member, message, ctx, apply);

    case 'setName': {
      const members = {
        ...touched.members,
        [memberId]: { ...member, name: message.name },
      };
      const next = { ...touched, members };
      return { state: next, effects: [{ to: 'all', message: { t: 'room', room: roomView(next, ctx) } }] };
    }

    case 'lock': {
      if (member.role !== 'host') return fail(touched, memberId, null, 'host-only');
      const next = { ...touched, locked: message.locked };
      return { state: next, effects: [{ to: 'all', message: { t: 'room', room: roomView(next, ctx) } }] };
    }

    case 'kick':
      return handleKick(touched, member, message.memberId, ctx);

    /**
     * Handing the room over. One host at a time, so this is a swap rather than
     * a promotion: whoever gives it away becomes an ordinary player, and can
     * then leave, which a host cannot.
     *
     * It is the way out of the room outliving its host - somebody whose phone
     * is dying, or who is going home early, can pass it on rather than close
     * the game on everyone.
     */
    case 'makeHost': {
      if (member.role !== 'host') return fail(touched, memberId, message.reqId, 'host-only');

      const heir = touched.members[message.memberId];
      // Handing it to yourself, or to somebody who has gone, is nothing.
      if (!heir || heir.memberId === memberId) {
        return fail(touched, memberId, message.reqId, 'unknown-action');
      }

      const members = {
        ...touched.members,
        [memberId]: { ...member, role: 'player' as const },
        [heir.memberId]: { ...heir, role: 'host' as const },
      };
      const next = { ...touched, members };
      return { state: next, effects: [{ to: 'all', message: { t: 'room', room: roomView(next, ctx) } }] };
    }

    case 'roundOpen': {
      if (member.role !== 'host') return fail(touched, memberId, message.reqId, 'host-only');
      const seats = seatView[touched.game](touched.snapshot).playerIds;
      if (!seats.includes(message.winnerId)) {
        return fail(touched, memberId, message.reqId, 'not-your-seat');
      }
      const next = { ...touched, pending: { winnerId: message.winnerId, racks: {} } };
      return { state: next, effects: [{ to: 'all', message: { t: 'room', room: roomView(next, ctx) } }] };
    }

    case 'rackSubmit': {
      if (!touched.pending) return fail(touched, memberId, message.reqId, 'unknown-action');
      // Your own rack only, unless you are the host filling in for someone.
      if (member.role !== 'host' && member.seatId !== message.seatId) {
        return fail(touched, memberId, message.reqId, 'not-your-seat');
      }
      if (message.seatId === touched.pending.winnerId) {
        // They went out, so by definition they hold nothing.
        return fail(touched, memberId, message.reqId, 'unknown-action');
      }
      const next = {
        ...touched,
        pending: {
          ...touched.pending,
          racks: { ...touched.pending.racks, [message.seatId]: message.total },
        },
      };
      return { state: next, effects: [{ to: 'all', message: { t: 'room', room: roomView(next, ctx) } }] };
    }

    /**
     * Ending the room, which only the host can do. There is deliberately no way
     * for a host to leave one: the game lives on the server, so a host walking
     * out would strand it with nobody able to add a player or change the rules.
     */
    case 'closeRoom': {
      if (member.role !== 'host') return fail(touched, memberId, message.reqId, 'host-only');
      return {
        state: touched,
        effects: [{ to: 'all', message: { t: 'closed' } }, { to: 'shutdown' }],
      };
    }

    /**
     * Leaving gives up the seat but leaves the player in the game, so a score
     * does not vanish from everyone else's board when someone puts their phone
     * away. The host can remove the player if they actually left the table.
     */
    case 'leave': {
      if (member.role === 'host') return fail(touched, memberId, message.reqId, 'host-only');
      const members = { ...touched.members };
      delete members[memberId];
      const next = { ...touched, members };
      return {
        state: next,
        effects: [
          { to: 'close', memberId },
          { to: 'all', message: { t: 'room', room: roomView(next, ctx) } },
        ],
      };
    }

    /**
     * Undoing a removal. The host is shown who they have thrown out and can
     * change their mind; `ref` is the public handle for an entry the room keeps
     * against a device key it never hands out.
     */
    case 'allowBack': {
      if (member.role !== 'host') return fail(touched, memberId, message.reqId, 'host-only');

      const entries = Object.entries(touched.kicked ?? {});
      const found = entries.find(([, entry]) => entry.ref === message.ref);
      if (!found) return fail(touched, memberId, message.reqId, 'unknown-action');

      const kicked = Object.fromEntries(entries.filter(([key]) => key !== found[0]));
      const next = { ...touched, kicked };
      return { state: next, effects: [{ to: 'all', message: { t: 'room', room: roomView(next, ctx) } }] };
    }

    case 'roundCancel': {
      if (member.role !== 'host') return fail(touched, memberId, message.reqId, 'host-only');
      const next = { ...touched, pending: null };
      return { state: next, effects: [{ to: 'all', message: { t: 'room', room: roomView(next, ctx) } }] };
    }

    default:
      return fail(touched, memberId, null, 'bad-message');
  }
}

function handleAction<S extends Snapshot>(
  state: RoomState<S>,
  member: StoredMember,
  message: Extract<ClientMessage, { t: 'action' }>,
  ctx: Context,
  apply: ApplyAction<S>,
): Outcome<S> {
  // A repeat of something already applied - a double tap, or a retry after a
  // reconnect. Silently accepted so the client is not told off for being careful.
  if (member.seen.includes(message.reqId)) return { state, effects: [] };

  // Requests are judged against the snapshot the sender actually saw. Anything
  // else would mean acting on a view of the game that has since moved on.
  if (message.rev !== state.rev) {
    return {
      state,
      effects: [
        { to: 'member', memberId: member.memberId, message: { t: 'error', reqId: message.reqId, code: 'stale-rev' } },
        { to: 'member', memberId: member.memberId, message: { t: 'state', rev: state.rev, state: state.snapshot, cause: null } },
      ],
    };
  }

  const view = seatView[state.game](state.snapshot);
  const verdict = permit(state.game, view, actorOf(member), message.action);
  if (!verdict.ok) return fail(state, member.memberId, message.reqId, verdict.code);

  const snapshot = apply(state.snapshot, message.action);

  // The game did not recognise the action, or its payload was malformed.
  if (snapshot === null) return fail(state, member.memberId, message.reqId, 'unknown-action');

  // A reducer returning the identical object means it refused the action - an
  // empty word, an undo with no history. Nothing changed, so nothing to say.
  if (snapshot === state.snapshot) {
    return {
      state: { ...state, members: { ...state.members, [member.memberId]: remember(member, message.reqId) } },
      effects: [],
    };
  }

  if (JSON.stringify(snapshot).length > MAX_STATE_BYTES) {
    return fail(state, member.memberId, message.reqId, 'too-large');
  }

  const cause: Cause = { memberId: member.memberId, actionType: message.action.type };
  const next: RoomState<S> = {
    ...state,
    rev: state.rev + 1,
    snapshot,
    // Recording the round is what ends the collection.
    pending: message.action.type === 'recordRound' ? null : state.pending,
    members: reconcileSeats(
      { ...state.members, [member.memberId]: remember(member, message.reqId) },
      snapshot,
      state.game,
    ),
  };

  const effects: Effect[] = [
    { to: 'all', message: { t: 'state', rev: next.rev, state: snapshot, cause } },
  ];
  // Removing or renaming a player changes what presence shows, and recording a
  // round ends the collection. Either way the room view has moved on.
  if (membersChanged(state.members, next.members) || next.pending !== state.pending) {
    effects.push({ to: 'all', message: { t: 'room', room: roomView(next, ctx) } });
  }
  return { state: next, effects };
}

function handleKick<S extends Snapshot>(
  state: RoomState<S>,
  actor: StoredMember,
  targetId: string,
  ctx: Context,
): Outcome<S> {
  if (actor.role !== 'host') return fail(state, actor.memberId, null, 'host-only');
  if (targetId === actor.memberId) return fail(state, actor.memberId, null, 'host-only');
  if (!state.members[targetId]) return { state, effects: [] };

  const target = state.members[targetId]!;
  const members = { ...state.members };
  delete members[targetId];

  /**
   * Written down against the device, and that is what makes it stick. The room
   * is not locked as a side effect: that used to be the only thing stopping a
   * rejoin, and it made throwing one person out into a decision about everybody
   * else. The host locks the door if they want the door locked.
   *
   * Their player stays on the board with its score, and stays spoken for, so
   * nobody can claim it while they are out.
   */
  const kicked = target.deviceKey
    ? { ...(state.kicked ?? {}), [target.deviceKey]: { ref: targetId, name: target.name } }
    : state.kicked;

  const next: RoomState<S> = { ...state, members, ...(kicked ? { kicked } : {}) };

  return {
    state: next,
    effects: [
      { to: 'member', memberId: targetId, message: { t: 'kicked' } },
      { to: 'close', memberId: targetId },
      { to: 'all', message: { t: 'room', room: roomView(next, ctx) } },
    ],
  };
}

/* ─────────────────────────── seat reconciliation ─────────────────────────── */

/**
 * Seats are derived from the game state after every change rather than tracked
 * as they go, so they cannot drift: if a player is gone from the game, nobody
 * is holding their seat.
 */
function reconcileSeats(
  members: Record<string, StoredMember>,
  snapshot: Snapshot,
  game: Game,
): Record<string, StoredMember> {
  const players = new Map(playersIn(snapshot).map((p) => [p.id, p.name]));
  const seats = new Set(seatView[game](snapshot).playerIds);

  const next: Record<string, StoredMember> = {};
  for (const [id, member] of Object.entries(members)) {
    if (member.seatId && !seats.has(member.seatId)) {
      next[id] = { ...member, seatId: null };
      continue;
    }
    // A seated member is shown under their player's name, so renaming the
    // player renames them everywhere rather than leaving the two disagreeing.
    const playerName = member.seatId ? players.get(member.seatId) : undefined;
    next[id] = playerName && playerName !== member.name ? { ...member, name: playerName } : member;
  }
  return next;
}

const membersChanged = (
  before: Record<string, StoredMember>,
  after: Record<string, StoredMember>,
): boolean =>
  Object.keys(after).some((id) =>
    before[id]?.seatId !== after[id]?.seatId || before[id]?.name !== after[id]?.name);
