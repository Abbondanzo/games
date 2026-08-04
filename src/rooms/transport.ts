/**
 * Talking to a room.
 *
 * The session hook depends on this interface rather than on WebSocket, so tests
 * can wire several clients to one real room in-process and drive the whole
 * protocol without a network.
 */
import {
  GONE_BY_CODE, decodeServerMessage, encode,
  type ClientMessage, type GoneReason, type ServerMessage,
} from '@shared/rooms/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'offline';

export interface TransportHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
  /**
   * The room will not have this device back. Nothing here retries afterwards,
   * and the caller is expected to forget the room rather than offer it again.
   */
  onGone: (reason: GoneReason) => void;
}

export interface Transport {
  send: (message: ClientMessage) => void;
  close: () => void;
}

export interface TransportOptions {
  baseUrl: string;
  code: string;
  token: string;
  handlers: TransportHandlers;
}

export type TransportFactory = (options: TransportOptions) => Transport;

/** Backoff is capped so a long outage does not leave someone waiting minutes. */
const MAX_RETRY_MS = 15_000;
const BASE_RETRY_MS = 500;

/**
 * Retrying stops after about a minute of failures. Not every reason a socket
 * will not open can be explained - an old room still refuses the upgrade
 * outright, and there the client sees nothing it can read - so the loop needs
 * an end of its own, or the app sits there flickering between trying and
 * failing. Coming back to the tab, or the network returning, starts it again.
 */
const MAX_ATTEMPTS = 8;

export const webSocketTransport: TransportFactory = ({ baseUrl, code, token, handlers }) => {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const url = () => {
    const target = new URL(`${baseUrl}/rooms/${code}/socket`);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    target.searchParams.set('t', token);
    return target.toString();
  };

  function open() {
    if (closed) return;
    handlers.onStatus('connecting');
    const ws = new WebSocket(url());
    socket = ws;

    ws.onopen = () => {
      attempt = 0;
      handlers.onStatus('open');
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = decodeServerMessage(event.data);
      // A frame this client cannot read is ignored rather than thrown on: it is
      // most likely a newer server, and throwing here would drop the socket.
      if (message) handlers.onMessage(message);
    };

    ws.onclose = (event) => {
      if (closed) return;
      handlers.onStatus('offline');

      // The room said why. Retrying cannot change any of those answers.
      const reason = GONE_BY_CODE[event.code];
      if (reason) {
        closed = true;
        handlers.onGone(reason);
        return;
      }
      schedule();
    };

    ws.onerror = () => ws.close();
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    if (attempt >= MAX_ATTEMPTS) return;
    // Jitter, so a room full of phones does not reconnect in lockstep.
    const delay = Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS) * (0.7 + Math.random() * 0.6);
    attempt += 1;
    timer = setTimeout(open, delay);
  }

  /**
   * Mobile browsers suspend backgrounded tabs and quietly drop the socket.
   * Without these the app looks broken every time someone glances away.
   */
  const wake = () => {
    if (closed || socket?.readyState === WebSocket.OPEN) return;
    if (timer) clearTimeout(timer);
    attempt = 0;
    open();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') wake();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', wake);

  open();

  return {
    send(message) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(encode(message));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', wake);
      socket?.close();
    },
  };
};

/* ─────────────────────────── which room server ─────────────────────────── */

export const PRODUCTION_ROOMS = 'https://games-rooms.abbondanzo.workers.dev';
export const STAGING_ROOMS = 'https://staging-games-rooms.abbondanzo.workers.dev';

/**
 * The origins that serve the live site. Everything else - pull request
 * previews, local dev, anything unrecognised - is not production.
 */
export const PRODUCTION_ORIGINS = [
  'https://games.abbondanzo.com',
  'https://games-ccu.pages.dev',
];

/**
 * Which room server this build should talk to.
 *
 * Decided from the origin rather than from a build variable set somewhere else,
 * because a variable that has to be remembered is a variable that will one day
 * be missing - and the failure would be silent, with a preview quietly writing
 * into somebody's real game. Reading it from the page means it cannot drift
 * from where the page is actually being served.
 *
 * Written as an allowlist for the same reason: an origin nobody thought of gets
 * staging, which is the harmless answer.
 */
export const roomsUrlFor = (origin: string): string =>
  (PRODUCTION_ORIGINS.includes(origin) ? PRODUCTION_ROOMS : STAGING_ROOMS);

/** Overridable, so dev can point at a wrangler running locally. */
export const ROOMS_URL: string =
  import.meta.env.VITE_ROOMS_URL ?? roomsUrlFor(window.location.origin);
