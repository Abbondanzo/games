/**
 * Talking to a room.
 *
 * The session hook depends on this interface rather than on WebSocket, so tests
 * can wire several clients to one real room in-process and drive the whole
 * protocol without a network.
 */
import {
  GONE_BY_CODE,
  decodeServerMessage,
  encode,
  type ClientMessage,
  type GoneReason,
  type ServerMessage,
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
    const delay =
      Math.min(BASE_RETRY_MS * 2 ** attempt, MAX_RETRY_MS) * (0.7 + Math.random() * 0.6);
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

/**
 * Where the room server lives.
 *
 * There is one, and it is production. A Pages preview talks to it, which means
 * a room made from a preview is a real room, in the same storage as everybody
 * else's game. That is a deliberate trade: a second room server would double
 * the builds on every push, and this is a score sheet.
 *
 * The way to try a change without touching real games is to run the server:
 *
 *   pnpm worker:dev
 *   VITE_ROOMS_URL=http://localhost:8787 pnpm dev
 *
 * That matters most for a protocol change, which a preview cannot exercise at
 * all: the preview client would be ahead of the deployed room and would only
 * ever show the version banner.
 */
export const PRODUCTION_ROOMS = 'https://games-rooms.abbondanzo.workers.dev';

/** Overridable, which is the whole of the local story. */
export const ROOMS_URL: string = import.meta.env.VITE_ROOMS_URL ?? PRODUCTION_ROOMS;
