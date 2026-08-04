/**
 * Reconnecting, and knowing when not to.
 *
 * The bug this covers: a device that still remembered a room which had since
 * ended would try it forever, flickering between getting back and not being
 * connected. A browser is never told why an upgrade failed, so the only way to
 * tell a room that is gone from a train tunnel is the close code the room sends
 * on the socket itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE, encode } from '@shared/rooms/protocol';
import {
  PRODUCTION_ORIGINS, PRODUCTION_ROOMS, STAGING_ROOMS, roomsUrlFor, webSocketTransport,
  type ConnectionStatus,
} from './transport';
import type { GoneReason, ServerMessage } from '@shared/rooms/protocol';

/** Every socket the transport opens, so a test can drive the last one. */
let opened: FakeSocket[] = [];
/**
 * Every transport started, so each is shut down afterwards. A live one keeps
 * listening for the tab and the network, and would answer the next test's
 * events as well as its own.
 */
let started: Harness[] = [];

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    opened.push(this);
  }

  /** The server accepting the socket. */
  accept() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** The server hanging up, with or without a reason. */
  hangUp(code: number) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeSocket.CLOSED;
  }
}

const latest = () => opened[opened.length - 1]!;

interface Harness {
  statuses: ConnectionStatus[];
  messages: ServerMessage[];
  gone: GoneReason[];
  close: () => void;
}

function start(): Harness {
  const statuses: ConnectionStatus[] = [];
  const messages: ServerMessage[] = [];
  const gone: GoneReason[] = [];
  const conn = webSocketTransport({
    baseUrl: 'https://rooms.test',
    code: 'AB23',
    token: 'tok',
    handlers: {
      onStatus: (s) => statuses.push(s),
      onMessage: (m) => messages.push(m),
      onGone: (r) => gone.push(r),
    },
  });
  const harness = { statuses, messages, gone, close: conn.close };
  started.push(harness);
  return harness;
}

/** Long enough for any scheduled retry to have fired. */
const waitOutBackoff = () => vi.advanceTimersByTime(60_000);

let original: typeof globalThis.WebSocket;

beforeEach(() => {
  vi.useFakeTimers();
  opened = [];
  started = [];
  original = globalThis.WebSocket;
  // @ts-expect-error - stands in for the real thing for the duration
  globalThis.WebSocket = FakeSocket;
});

afterEach(() => {
  for (const harness of started) harness.close();
  globalThis.WebSocket = original;
  vi.useRealTimers();
});

describe('connecting', () => {
  it('opens one socket, carrying the code and the token', () => {
    start();
    expect(opened).toHaveLength(1);
    expect(latest().url).toContain('/rooms/AB23/socket');
    expect(latest().url).toContain('t=tok');
  });

  it('asks for a secure socket when the room is served securely', () => {
    start();
    expect(latest().url.startsWith('wss://')).toBe(true);
  });

  it('says when it is connected', () => {
    const h = start();
    latest().accept();
    expect(h.statuses).toEqual(['connecting', 'open']);
  });

  it('passes on what the room says', () => {
    const h = start();
    latest().accept();
    const message = { t: 'error', reqId: null, code: 'host-only' } as const;
    latest().onmessage?.({ data: encode(message) });
    expect(h.messages).toEqual([message]);
  });

  it('ignores a frame it cannot read rather than dropping the socket', () => {
    const h = start();
    latest().accept();
    latest().onmessage?.({ data: '{"t":"from-the-future"}' });
    expect(h.messages).toEqual([]);
    expect(h.gone).toEqual([]);
  });
});

describe('a connection that drops', () => {
  it('tries again', () => {
    const h = start();
    latest().accept();
    latest().hangUp(1006);

    expect(h.statuses).toContain('offline');
    vi.advanceTimersByTime(2_000);
    expect(opened.length).toBeGreaterThan(1);
  });

  it('backs off rather than hammering', () => {
    start();
    latest().hangUp(1006);
    vi.advanceTimersByTime(2_000);
    latest().hangUp(1006);

    // The second wait is longer than the first, so nothing happens yet.
    const before = opened.length;
    vi.advanceTimersByTime(400);
    expect(opened).toHaveLength(before);
  });

  /**
   * Not every refusal can be explained: a room deployed before close codes
   * existed simply turns the upgrade away, and the client sees nothing it can
   * read. Without an end to the loop that is the flickering the bug described.
   */
  it('gives up rather than retrying forever', () => {
    start();
    for (let i = 0; i < 40; i += 1) {
      latest().hangUp(1006);
      waitOutBackoff();
    }
    expect(opened.length).toBeLessThan(12);
  });

  it('starts again when the network comes back', () => {
    start();
    for (let i = 0; i < 40; i += 1) {
      latest().hangUp(1006);
      waitOutBackoff();
    }
    const gaveUpAfter = opened.length;

    window.dispatchEvent(new Event('online'));
    expect(opened.length).toBe(gaveUpAfter + 1);
  });

  it('starts again when the tab is looked at', () => {
    start();
    latest().hangUp(1006);
    waitOutBackoff();
    const before = opened.length;

    document.dispatchEvent(new Event('visibilitychange'));
    expect(opened.length).toBe(before + 1);
  });
});

describe('a room that will not have this device back', () => {
  it.each([
    ['ended', CLOSE.ended],
    ['removed', CLOSE.removed],
    ['unauthorised', CLOSE.unauthorised],
  ] as [GoneReason, number][])('says %s and stops', (reason, code) => {
    const h = start();
    latest().accept();
    latest().hangUp(code);

    expect(h.gone).toEqual([reason]);
    waitOutBackoff();
    expect(opened).toHaveLength(1);
  });

  // The flicker in the bug report: it kept trying, so it kept failing.
  it('does not try again when the tab is looked at', () => {
    const h = start();
    latest().hangUp(CLOSE.ended);

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    waitOutBackoff();

    expect(opened).toHaveLength(1);
    expect(h.gone).toEqual(['ended']);
  });

  it('is refused before it ever connects, and still hears why', () => {
    const h = start();
    // The room turns the socket away without accepting it.
    latest().hangUp(CLOSE.ended);
    expect(h.gone).toEqual(['ended']);
  });
});

describe('closing on purpose', () => {
  it('does not reconnect afterwards', () => {
    const h = start();
    latest().accept();
    h.close();
    latest().hangUp(1006);

    waitOutBackoff();
    expect(opened).toHaveLength(1);
  });

  it('says nothing about the room being gone', () => {
    const h = start();
    h.close();
    latest().hangUp(CLOSE.ended);
    expect(h.gone).toEqual([]);
  });

  it('stops listening for the tab and the network', () => {
    const h = start();
    h.close();

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(opened).toHaveLength(1);
  });
});

describe('sending', () => {
  const lock = { t: 'lock', locked: true } as const;

  it('goes out once the socket is open', () => {
    const conn = webSocketTransport({
      baseUrl: 'https://rooms.test',
      code: 'AB23',
      token: 'tok',
      handlers: { onStatus: () => {}, onMessage: () => {}, onGone: () => {} },
    });
    started.push({ statuses: [], messages: [], gone: [], close: conn.close });

    latest().accept();
    conn.send(lock);
    expect(latest().sent).toEqual([encode(lock)]);
  });

  // Nothing queues: the room resends the whole game on reconnect anyway, so a
  // held-back request would arrive against a game that had moved on.
  it('is dropped rather than thrown when there is nothing to send down', () => {
    const conn = webSocketTransport({
      baseUrl: 'https://rooms.test',
      code: 'AB23',
      token: 'tok',
      handlers: { onStatus: () => {}, onMessage: () => {}, onGone: () => {} },
    });
    started.push({ statuses: [], messages: [], gone: [], close: conn.close });

    latest().hangUp(1006);
    expect(() => conn.send(lock)).not.toThrow();
    expect(latest().sent).toEqual([]);
  });
});

/**
 * Which room server a build talks to.
 *
 * This is the guard against a preview writing into somebody's real game. It is
 * an allowlist on purpose: only the origins that serve the live site get the
 * live rooms, and anything unrecognised gets staging, which holds nothing that
 * matters.
 */
describe('choosing a room server', () => {
  it.each(PRODUCTION_ORIGINS)('gives %s the live rooms', (origin) => {
    expect(roomsUrlFor(origin)).toBe(PRODUCTION_ROOMS);
  });

  it.each([
    ['a pull request preview', 'https://0fc473c3.games-ccu.pages.dev'],
    ['a branch preview', 'https://stale-rooms.games-ccu.pages.dev'],
    ['local dev', 'http://localhost:5173'],
    ['a local production build', 'http://localhost:4173'],
    ['nothing recognisable', 'https://somewhere.example'],
    ['no origin at all', ''],
  ])('keeps %s away from them', (_label, origin) => {
    expect(roomsUrlFor(origin)).toBe(STAGING_ROOMS);
  });

  // A lookalike is the case an endsWith check would have got wrong.
  it.each([
    'https://games.abbondanzo.com.evil.example',
    'https://evil.example/https://games.abbondanzo.com',
    'http://games.abbondanzo.com',
  ])('is not fooled by %s', (origin) => {
    expect(roomsUrlFor(origin)).toBe(STAGING_ROOMS);
  });

  it('keeps the two apart', () => {
    expect(PRODUCTION_ROOMS).not.toBe(STAGING_ROOMS);
  });
});
