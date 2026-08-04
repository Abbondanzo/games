/**
 * A whole room, in one process, with no network.
 *
 * Several clients are wired to a real RoomCore, so a single jsdom test can
 * render a host and a guest side by side, click in one and assert the other
 * updates. It is the closest thing to a two-device test that can run in CI, and
 * it drives the actual protocol rather than a mock of it: every message is
 * encoded and decoded exactly as it would be over a socket, so a codec bug
 * shows up here too.
 *
 * Test-only, but it lives beside the code it stands in for so the two stay in
 * step.
 */
import {
  connect, createRoom, handle, join,
  type Context, type Effect, type RoomState,
} from '@shared/rooms/roomCore';
import { decodeServerMessage, encode, type Game } from '@shared/rooms/protocol';
import { GAME_SETUP } from '@shared/rooms/games';
import type { TransportFactory, TransportHandlers } from './transport';
import { writeSession, type StoredSession } from './storage';

export interface TestRoom {
  code: string;
  /** Adds a member and returns the session the real server would have issued. */
  /**
   * Adds a member as a join would. `device` is the secret that device keeps for
   * this room: pass the same one twice to test somebody coming back.
   */
  addMember: (name: string, device?: string | null, claim?: string | null) => StoredSession;
  /** The host's session, created with the room. */
  hostSession: StoredSession;
  /** Hands a session to this tab, as create or join would. */
  signIn: (session: StoredSession) => void;
  /** Optionally pretends to be a room of a different protocol version. */
  transport: (options?: { protocol?: number }) => TransportFactory;
  /** The room's own view, for asserting on the server rather than the UI. */
  state: () => RoomState;
}

export function createTestRoom(game: Game, hostName = 'Host'): TestRoom {
  let ids = 0;
  const nextId = () => `t${ids++}`;
  const apply = GAME_SETUP[game].apply(nextId);

  const hostId = nextId();
  let state: RoomState = createRoom({
    code: 'AB2D',
    game,
    host: { memberId: hostId, name: hostName },
    snapshot: GAME_SETUP[game].initial(),
    now: 1_000,
    apply,
  });

  const tokens = new Map<string, string>([['host-token', hostId]]);
  const sockets = new Map<string, TransportHandlers[]>();

  const ctx = (): Context => ({ online: [...sockets.keys()], now: 1_000 });

  function deliver(effects: Effect[]): void {
    for (const effect of effects) {
      // Dropping a socket carries a reason in production, because a browser is
      // told nothing else about why one closed. Modelled here so the client's
      // handling of it is exercised rather than assumed.
      if (effect.to === 'shutdown') {
        const everyone = [...sockets.values()].flat();
        sockets.clear();
        for (const handlers of everyone) handlers.onGone('ended');
        continue;
      }
      if (effect.to === 'close') {
        const dropped = sockets.get(effect.memberId) ?? [];
        sockets.delete(effect.memberId);
        for (const handlers of dropped) handlers.onGone('removed');
        continue;
      }
      const targets = effect.to === 'all'
        ? [...sockets.values()].flat()
        : sockets.get(effect.memberId) ?? [];

      const raw = encode(effect.message);
      for (const handlers of targets) {
        const decoded = decodeServerMessage(raw);
        if (decoded) handlers.onMessage(decoded);
      }
    }
  }

  return {
    code: 'AB2D',
    hostSession: { game, code: 'AB2D', token: 'host-token', memberId: hostId },
    state: () => state,

    addMember(name, device, claim) {
      const memberId = nextId();
      const token = `token-${memberId}`;
      // The Worker hashes the secret before the room sees it; the prefix stands
      // in for that, so nothing here can pass a raw secret off as a key.
      const deviceKey = device ? `sha256:${device}` : null;
      const result = join(state, { memberId, name, now: 1_000, deviceKey, claim }, apply);
      if (!result.ok) throw new Error(`join refused: ${result.code}`);
      state = result.state;
      deliver(result.effects);
      tokens.set(token, memberId);
      return { game, code: 'AB2D', token, memberId };
    },

    signIn: writeSession,

    transport: (options) => ({ token, handlers }) => {
      const memberId = tokens.get(token);
      if (!memberId) throw new Error('unknown token');

      sockets.set(memberId, [...(sockets.get(memberId) ?? []), handlers]);
      handlers.onStatus('open');

      const opened = connect(state, memberId, ctx());
      state = opened.state;
      deliver(options?.protocol === undefined
        ? opened.effects
        : opened.effects.map((e) => (e.to === 'member' && e.message.t === 'welcome'
          ? { ...e, message: { ...e.message, protocol: options.protocol! } }
          : e)));

      return {
        send(message) {
          const outcome = handle(state, memberId, message, ctx(), apply);
          state = outcome.state;
          deliver(outcome.effects);
        },
        close() {
          sockets.delete(memberId);
        },
      };
    },
  };
}
