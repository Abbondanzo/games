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
  type ApplyAction, type Context, type Effect, type RoomState,
} from '@shared/rooms/roomCore';
import { decodeServerMessage, encode, type Game, type Snapshot } from '@shared/rooms/protocol';
import { cricketApply, cricketInitialState } from '@shared/rooms/games/cricket';
import { scrabbleApply, scrabbleInitialState } from '@shared/rooms/games/scrabble';
import { rummikubApply, rummikubInitialState } from '@shared/rooms/games/rummikub';
import type { TransportFactory, TransportHandlers } from './transport';
import { writeSession, type StoredSession } from './storage';

interface Setup {
  initial: () => Snapshot;
  apply: (uid: () => string) => ApplyAction<Snapshot>;
}

const SETUP: Record<Game, Setup> = {
  cricket: { initial: cricketInitialState, apply: cricketApply },
  scrabble: { initial: scrabbleInitialState, apply: scrabbleApply },
  rummikub: { initial: rummikubInitialState, apply: rummikubApply },
};

export interface TestRoom {
  code: string;
  /** Adds a member and returns the session the real server would have issued. */
  addMember: (name: string) => StoredSession;
  /** The host's session, created with the room. */
  hostSession: StoredSession;
  /** Hands a session to this tab, as create or join would. */
  signIn: (session: StoredSession) => void;
  transport: TransportFactory;
  /** The room's own view, for asserting on the server rather than the UI. */
  state: () => RoomState;
}

export function createTestRoom(game: Game, hostName = 'Host'): TestRoom {
  let ids = 0;
  const nextId = () => `t${ids++}`;
  const apply = SETUP[game].apply(nextId);

  const hostId = nextId();
  let state: RoomState = createRoom({
    code: 'AB2D',
    game,
    host: { memberId: hostId, name: hostName },
    snapshot: SETUP[game].initial(),
    now: 1_000,
  });

  const tokens = new Map<string, string>([['host-token', hostId]]);
  const sockets = new Map<string, TransportHandlers[]>();

  const ctx = (): Context => ({ online: [...sockets.keys()], now: 1_000 });

  function deliver(effects: Effect[]): void {
    for (const effect of effects) {
      if (effect.to === 'close') {
        sockets.delete(effect.memberId);
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

    addMember(name) {
      const memberId = nextId();
      const token = `token-${memberId}`;
      const result = join(state, { memberId, name, now: 1_000 });
      if (!result.ok) throw new Error(`join refused: ${result.code}`);
      state = result.state;
      tokens.set(token, memberId);
      return { game, code: 'AB2D', token, memberId };
    },

    signIn: writeSession,

    transport: ({ token, handlers }) => {
      const memberId = tokens.get(token);
      if (!memberId) throw new Error('unknown token');

      sockets.set(memberId, [...(sockets.get(memberId) ?? []), handlers]);
      handlers.onStatus('open');

      const opened = connect(state, memberId, ctx());
      state = opened.state;
      deliver(opened.effects);

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
