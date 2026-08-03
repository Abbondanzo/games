/**
 * Talking to a room.
 *
 * The session hook depends on this interface rather than on WebSocket, so tests
 * can wire several clients to one real room in-process and drive the whole
 * protocol without a network.
 */
import { decodeServerMessage, encode, type ClientMessage, type ServerMessage } from '@shared/rooms/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'offline';

export interface TransportHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
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
      // 4001 unauthorised, 4003 removed: retrying will not help.
      if (event.code === 4001 || event.code === 4003) return;
      schedule();
    };

    ws.onerror = () => ws.close();
  }

  function schedule() {
    if (timer) clearTimeout(timer);
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

/** Where the room server lives. Overridable so dev can point at wrangler. */
export const ROOMS_URL: string =
  import.meta.env.VITE_ROOMS_URL ?? 'https://games-rooms.abbondanzo.workers.dev';
