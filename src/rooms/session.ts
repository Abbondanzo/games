/**
 * A game, played alone or in a room, behind one hook.
 *
 * Solo is exactly what it always was: a local reducer writing to localStorage,
 * with no socket ever constructed. In a room the client is thin - the room owns
 * the state, and everything here does is send requests and render what comes
 * back. The `{ state, dispatch }` half of the return value is identical either
 * way, so the trackers and their tests do not know the difference.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  compareProtocol,
  type ErrorCode, type Game, type GameAction, type Member, type Role, type Snapshot,
  type VersionGap,
} from '@shared/rooms/protocol';
import { can as canDo, seatView } from '@shared/rooms/permissions';
import {
  ROOMS_URL, webSocketTransport,
  type ConnectionStatus, type Transport, type TransportFactory,
} from './transport';
import { clearSession, readSession, writeSession, type StoredSession } from './storage';
import { useRoomOverrides } from './RoomProvider';

/** Applied internally when a room broadcast arrives. Never sent over the wire. */
interface SnapshotAction {
  type: '__snapshot';
  state: Snapshot;
}

const isSnapshot = (action: unknown): action is SnapshotAction =>
  typeof action === 'object' && action !== null && (action as SnapshotAction).type === '__snapshot';

export interface RoomHandle {
  code: string;
  role: Role;
  memberId: string;
  seatId: string | null;
  members: Member[];
  locked: boolean;
  status: ConnectionStatus;
  /** True while a request is in flight, so entry controls can wait. */
  sending: boolean;
  lastError: ErrorCode | null;
  /**
   * Set when this app and the room are different versions. Worth surfacing:
   * otherwise a button the room has never heard of just appears to be broken.
   */
  outdated: VersionGap | null;
  /** Would the room accept this kind of action from me right now? */
  can: (actionType: string) => boolean;
  setLocked: (locked: boolean) => void;
  kick: (memberId: string) => void;
  /**
   * Stop following the room. Guests only: a host cannot leave, because the game
   * lives in the room and walking out would strand it with nobody able to
   * administer it. This does nothing when called by the host.
   */
  leave: () => void;
  /** Ends the room for everyone. Host only. */
  close: () => void;
}

export interface GameSessionOptions<S extends Snapshot, A> {
  game: Game;
  reducer: (state: S, action: A) => S;
  initialState: S;
  readStored: () => S | null;
  storeKey: string;
  /** Injected by tests to run several clients against one in-process room. */
  transport?: TransportFactory;
}

export interface GameSession<S, A> {
  state: S;
  dispatch: (action: A) => void;
  /** Null when playing alone. */
  room: RoomHandle | null;
  /** Called when the room refuses an action, so entry state can be put back. */
  onReject: (handler: (action: A, code: ErrorCode) => void) => void;
}

let requestCounter = 0;
const nextRequestId = () => `r${Date.now().toString(36)}-${requestCounter++}`;

export function useGameSession<S extends Snapshot, A extends { type: string }>(
  options: GameSessionOptions<S, A>,
): GameSession<S, A> {
  const { game, reducer, initialState, readStored, storeKey } = options;
  const overrides = useRoomOverrides();

  const [session, setSession] = useState<StoredSession | null>(
    () => (overrides.session !== undefined ? overrides.session : readSession(game)),
  );

  // Snapshots replace the state wholesale; everything else goes to the reducer.
  const wrapped = useCallback(
    (state: S, action: A | SnapshotAction): S =>
      (isSnapshot(action) ? (action.state as S) : reducer(state, action)),
    [reducer],
  );

  const [state, rawDispatch] = useReducer(
    wrapped,
    initialState,
    (init) => (session ? init : readStored() ?? init),
  );

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [members, setMembers] = useState<Member[]>([]);
  const [locked, setLocked] = useState(false);
  const [seatId, setSeatId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>('player');
  const [lastError, setLastError] = useState<ErrorCode | null>(null);
  const [pending, setPending] = useState(0);
  const [outdated, setOutdated] = useState<VersionGap | null>(null);

  const transport = useRef<Transport | null>(null);
  const rev = useRef(0);
  const roleRef = useRef<Role>('player');
  const stateRef = useRef<S>(initialState);
  const inFlight = useRef(new Map<string, A>());
  const rejectHandler = useRef<(action: A, code: ErrorCode) => void>(() => {});

  // Read in the close handler, which cannot see the render's state.
  stateRef.current = state;

  /** Writes what the room last sent into this device's own save. */
  const keepLocally = useCallback(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(stateRef.current));
    } catch {
      // Storage can be unavailable; nothing more to do.
    }
  }, [storeKey]);

  /* ── solo: persist exactly as before ── */
  useEffect(() => {
    if (session) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      // Storage can be unavailable (private browsing); the session still works.
    }
  }, [session, state, storeKey]);

  /* ── in a room: stay connected ── */
  useEffect(() => {
    if (!session) return undefined;

    const factory = options.transport ?? overrides.transport ?? webSocketTransport;
    const conn = factory({
      baseUrl: ROOMS_URL,
      code: session.code,
      token: session.token,
      handlers: {
        onStatus: setStatus,
        onMessage: (message) => {
          switch (message.t) {
            case 'welcome':
              rev.current = message.rev;
              setOutdated(compareProtocol(message.protocol));
              roleRef.current = message.you.role;
              setRole(message.you.role);
              setSeatId(message.you.seatId);
              setMembers(message.room.members);
              setLocked(message.room.locked);
              rawDispatch({ type: '__snapshot', state: message.state });
              break;

            case 'state':
              rev.current = message.rev;
              inFlight.current.clear();
              setPending(0);
              setLastError(null);
              rawDispatch({ type: '__snapshot', state: message.state });
              break;

            case 'room': {
              setMembers(message.room.members);
              setLocked(message.room.locked);
              const me = message.room.members.find((m) => m.memberId === session.memberId);
              if (me) {
                setSeatId(me.seatId);
                roleRef.current = me.role;
                setRole(me.role);
              }
              break;
            }

            case 'error': {
              setLastError(message.code);
              setPending((n) => Math.max(0, n - 1));
              const action = message.reqId ? inFlight.current.get(message.reqId) : undefined;
              if (message.reqId) inFlight.current.delete(message.reqId);
              // Give the tracker its entry back, or the player loses what they typed.
              if (action) rejectHandler.current(action, message.code);
              break;
            }

            case 'kicked':
              clearSession(game);
              setSession(null);
              break;

            case 'closed':
              // The host started this game and has just stopped sharing it, so
              // it carries on here rather than disappearing with the room.
              if (roleRef.current === 'host') keepLocally();
              clearSession(game);
              setSession(null);
              break;
          }
        },
      },
    });

    transport.current = conn;
    return () => {
      conn.close();
      transport.current = null;
    };
  }, [session, game, options.transport, overrides.transport]);

  const dispatch = useCallback(
    (action: A) => {
      if (!session) {
        rawDispatch(action);
        return;
      }
      const reqId = nextRequestId();
      inFlight.current.set(reqId, action);
      setPending((n) => n + 1);
      setLastError(null);
      transport.current?.send({
        t: 'action',
        reqId,
        rev: rev.current,
        action: action as unknown as GameAction,
      });
    },
    [session],
  );

  const onReject = useCallback((handler: (action: A, code: ErrorCode) => void) => {
    rejectHandler.current = handler;
  }, []);

  const room = useMemo<RoomHandle | null>(() => {
    if (!session) return null;
    const view = seatView[game](state);
    const actor = { role, memberId: session.memberId, seatId };
    return {
      code: session.code,
      role,
      memberId: session.memberId,
      seatId,
      members,
      locked,
      status,
      sending: pending > 0,
      lastError,
      outdated,
      can: (actionType: string) => canDo(game, view, actor, actionType),
      setLocked: (value) => transport.current?.send({ t: 'lock', locked: value }),
      kick: (memberId) => transport.current?.send({ t: 'kick', memberId }),
      leave: () => {
        // A host has no way out that is not closing the room.
        if (role === 'host') return;
        clearSession(game);
        setSession(null);
      },
      close: () => transport.current?.send({ t: 'closeRoom', reqId: nextRequestId() }),
    };
  }, [session, game, state, role, seatId, members, locked, status, pending, lastError, outdated]);

  return { state, dispatch, room, onReject };
}

/** Called after create or join to attach this tab to a room. */
export function enterRoom(session: StoredSession): void {
  writeSession(session);
}
