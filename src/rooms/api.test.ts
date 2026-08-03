import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ERRORS, createRoom, joinRoom, peekRoom } from './api';

const respond = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const mockFetch = (impl: () => Promise<Response>) => {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe('creating a room', () => {
  it('returns the session the server issued', async () => {
    mockFetch(async () => respond(200, {
      code: 'AB2D', token: 't', memberId: 'm', game: 'cricket',
    }));
    await expect(createRoom('cricket', 'Ada')).resolves.toEqual({
      ok: true,
      value: { code: 'AB2D', token: 't', memberId: 'm', game: 'cricket' },
    });
  });

  // A response we cannot make sense of is a failure, not a half-built session.
  it('refuses a reply that is missing fields', async () => {
    mockFetch(async () => respond(200, { code: 'AB2D' }));
    await expect(createRoom('cricket', 'Ada')).resolves.toEqual({
      ok: false, error: 'unreachable',
    });
  });

  it('refuses a reply naming a game that does not exist', async () => {
    mockFetch(async () => respond(200, {
      code: 'AB2D', token: 't', memberId: 'm', game: 'chess',
    }));
    await expect(createRoom('cricket', 'Ada')).resolves.toMatchObject({ ok: false });
  });
});

/** Each of these becomes something the player can be told plainly. */
describe('what can go wrong', () => {
  it.each([
    [404, 'no-room'],
    [429, 'rate-limited'],
    [500, 'unreachable'],
    [503, 'unreachable'],
  ] as const)('maps %i to %s', async (status, error) => {
    mockFetch(async () => respond(status));
    await expect(joinRoom('AB2D', 'Grace')).resolves.toEqual({ ok: false, error });
  });

  // 409 covers two different refusals, so the body decides which.
  it('tells a locked room from a full one', async () => {
    mockFetch(async () => respond(409, { error: 'room-full' }));
    await expect(joinRoom('AB2D', 'Grace')).resolves.toEqual({ ok: false, error: 'room-full' });

    mockFetch(async () => respond(409, { error: 'room-locked' }));
    await expect(joinRoom('AB2D', 'Grace')).resolves.toEqual({ ok: false, error: 'room-locked' });
  });

  it('treats a dead network as unreachable rather than throwing', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(joinRoom('AB2D', 'Grace')).resolves.toEqual({ ok: false, error: 'unreachable' });
  });

  it('survives a body that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new Error('not json'); },
    }) as unknown as Response));
    await expect(peekRoom('AB2D')).resolves.toMatchObject({ ok: false });
  });
});

describe('looking a code up', () => {
  it('reports which game it belongs to', async () => {
    mockFetch(async () => respond(200, { game: 'rummikub', open: true }));
    await expect(peekRoom('AB2D')).resolves.toEqual({
      ok: true, value: { game: 'rummikub', open: true },
    });
  });

  it('says nothing is there for an unknown code', async () => {
    mockFetch(async () => respond(404));
    await expect(peekRoom('ZZZZ')).resolves.toEqual({ ok: false, error: 'no-room' });
  });
});

describe('the messages a player sees', () => {
  it('covers every failure', () => {
    for (const error of ['no-room', 'room-locked', 'room-full', 'rate-limited', 'unreachable'] as const) {
      expect(ROOM_ERRORS[error]).toBeTruthy();
    }
  });

  // Same rule as everywhere else: no status codes, no networking words.
  it('carries no jargon', () => {
    const JARGON = /\b(http|websocket|socket|server|token|payload|\d{3})\b/i;
    for (const [key, message] of Object.entries(ROOM_ERRORS)) {
      expect(message, key).not.toMatch(JARGON);
      expect(message, key).toMatch(/^[A-Z].*[.!]$/);
    }
  });
});
