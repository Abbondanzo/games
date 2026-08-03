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
  return { members, locked: state.locked, pending: state.pending };
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
function seatNewcomer<S extends Snapshot>(
  game: Game,
  snapshot: S,
  claimed: ReadonlySet<string | null>,
  wanted: string,
  apply: ApplyAction<S>,
): { snapshot: S; seatId: string | null; name: string } {
  const existing = playersIn(snapshot).find((p) => p.name === wanted.trim() && !claimed.has(p.id));
  if (existing) return { snapshot, seatId: existing.id, name: existing.name };

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
  host: { memberId: string; name: string };
  snapshot: S;
  now: number;
  apply: ApplyAction<S>;
}): RoomState<S> {
  // The host is a player like anyone else, unless they chose not to be named.
  const seated = seatNewcomer(
    input.game, input.snapshot, new Set(), input.host.name, input.apply,
  );

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
        seen: [],
      },
    },
    locked: false,
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
  if (!taken.includes(trimmed)) return trimmed;
  for (let n = 2; n < 100; n++) {
    const candidate = `${trimmed} ${n}`;
    if (!taken.includes(candidate)) return candidate;
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
  input: { memberId: string; name: string; now: number },
  apply: ApplyAction<S>,
): JoinResult<S> {
  if (state.locked) return { ok: false, code: 'room-locked' };
  if (Object.keys(state.members).length >= MAX_MEMBERS) return { ok: false, code: 'room-full' };

  const claimed = new Set(Object.values(state.members).map((m) => m.seatId));
  const seated = seatNewcomer(state.game, state.snapshot, claimed, input.name, apply);
  const added = seated.snapshot !== state.snapshot;

  const member: StoredMember = {
    memberId: input.memberId,
    name: seated.name,
    role: 'player',
    seatId: seated.seatId,
    seen: [],
  };

  const next: RoomState<S> = {
    ...state,
    snapshot: seated.snapshot,
    rev: added ? state.rev + 1 : state.rev,
    members: { ...state.members, [input.memberId]: member },
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

  const members = { ...state.members };
  delete members[targetId];

  // Kicking without locking is theatre: they would simply rejoin with a new id.
  const next: RoomState<S> = { ...state, members, locked: true };

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
