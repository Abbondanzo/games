import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES, ERROR_MESSAGES, MAX_FRAME_BYTES, PROTOCOL_VERSION,
  type ClientMessage, type ServerMessage,
  decodeClientMessage, decodeServerMessage, encode,
} from './protocol';

const CLIENT: ClientMessage[] = [
  { t: 'action', reqId: 'r1', rev: 7, action: { type: 'recordTurn', darts: [] } },
  { t: 'setName', name: 'Ada' },
  { t: 'lock', locked: true },
  { t: 'kick', memberId: 'm1' },
  { t: 'roundOpen', reqId: 'r4', winnerId: 'p1' },
  { t: 'rackSubmit', reqId: 'r5', seatId: 'p2', total: 24 },
  { t: 'roundCancel', reqId: 'r6' },
  { t: 'closeRoom', reqId: 'r7' },
];

const SERVER: ServerMessage[] = [
  {
    t: 'welcome',
    protocol: PROTOCOL_VERSION,
    code: 'AB2D',
    game: 'cricket',
    you: { memberId: 'm1', role: 'host', seatId: null, name: 'Ada' },
    rev: 0,
    state: { players: [], turns: [] },
    room: { members: [], locked: false, pending: null },
  },
  { t: 'state', rev: 3, state: { players: [] }, cause: { memberId: 'm1', actionType: 'pass' } },
  { t: 'state', rev: 4, state: {}, cause: null },
  {
    t: 'room',
    room: {
      members: [{ memberId: 'm1', name: 'Ada', role: 'host', seatId: 'p1', online: true }],
      locked: true,
      pending: { winnerId: 'p1', racks: { p2: 24 } },
    },
  },
  { t: 'error', reqId: 'r1', code: 'not-your-turn' },
  { t: 'error', reqId: null, code: 'rate-limited' },
  { t: 'kicked' },
  { t: 'closed' },
];

describe('round trips', () => {
  it.each(CLIENT.map((m) => [m.t, m] as const))('client %s', (_t, message) => {
    expect(decodeClientMessage(encode(message))).toEqual(message);
  });

  it.each(SERVER.map((m) => [m.t, m] as const))('server %s', (_t, message) => {
    expect(decodeServerMessage(encode(message))).toEqual(message);
  });
});

/**
 * Anything off a socket is untrusted. These must all be dropped, never thrown
 * on: an exception inside a socket handler takes the connection down.
 */
describe('malformed input is dropped, not thrown on', () => {
  const JUNK = [
    ['not json', 'nonsense{'],
    ['a bare number', '42'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['no discriminator', '{"reqId":"r1"}'],
    ['an unknown type', '{"t":"launchMissiles"}'],
    ['a missing field', '{"t":"action","reqId":"r1","rev":1}'],
    ['a wrong-typed field', '{"t":"action","reqId":"r1","rev":"seven","action":{"type":"x"}}'],
    ['a negative revision', '{"t":"action","reqId":"r1","rev":-1,"action":{"type":"x"}}'],
    ['a fractional revision', '{"t":"action","reqId":"r1","rev":1.5,"action":{"type":"x"}}'],
    ['an action with no type', '{"t":"action","reqId":"r1","rev":1,"action":{}}'],
    ['an action that is a string', '{"t":"action","reqId":"r1","rev":1,"action":"go"}'],
    ['an empty id', '{"t":"kick","memberId":""}'],
    ['a non-boolean lock', '{"t":"lock","locked":"yes"}'],
    ['a prototype-pollution key', '{"t":"setName","name":"Ada","__proto__":{"admin":true}}'],
  ] as const;

  it.each(JUNK)('drops %s', (_label, raw) => {
    expect(() => decodeClientMessage(raw)).not.toThrow();
    // The prototype key is ignored rather than making the whole frame invalid.
    const decoded = decodeClientMessage(raw);
    if (decoded) expect(decoded.t).toBe('setName');
  });

  it('drops an oversized frame without parsing it', () => {
    const huge = `{"t":"setName","name":"${'a'.repeat(MAX_FRAME_BYTES)}"}`;
    expect(decodeClientMessage(huge)).toBeNull();
  });

  it('caps names rather than accepting any length', () => {
    expect(decodeClientMessage(encode({ t: 'setName', name: 'a'.repeat(25) }))).toBeNull();
    expect(decodeClientMessage(encode({ t: 'setName', name: 'a'.repeat(24) }))).not.toBeNull();
  });

  it('does not let a prototype key reach the decoded object', () => {
    const decoded = decodeClientMessage('{"t":"setName","name":"Ada","__proto__":{"x":1}}');
    expect(decoded).toEqual({ t: 'setName', name: 'Ada' });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it.each([
    ['a bad role', '{"t":"welcome","protocol":1,"code":"AB2D","game":"cricket","you":{"memberId":"m","role":"admin","seatId":null,"name":"A"},"rev":0,"state":{},"room":{"members":[],"locked":false}}'],
    ['an unknown game', '{"t":"welcome","protocol":1,"code":"AB2D","game":"chess","you":{"memberId":"m","role":"host","seatId":null,"name":"A"},"rev":0,"state":{},"room":{"members":[],"locked":false}}'],
    ['an unknown error code', '{"t":"error","reqId":null,"code":"teapot"}'],
  ])('drops server frames with %s', (_label, raw) => {
    expect(decodeServerMessage(raw)).toBeNull();
  });
});

describe('player-facing copy', () => {
  it('covers every error code', () => {
    for (const code of ERROR_CODES) expect(ERROR_MESSAGES[code]).toBeTruthy();
  });

  // Same rule the dictionary copy follows: no status codes, no networking words.
  it('carries no jargon', () => {
    const JARGON = /\b(http|websocket|socket|rev|revision|token|payload|server|\d{3})\b/i;
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message, code).not.toMatch(JARGON);
    }
  });

  it('reads as sentences', () => {
    for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
      expect(message, code).toMatch(/^[A-Z].*[.!]$/);
    }
  });
});
