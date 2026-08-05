/**
 * The Worker's front door.
 *
 * Everything past this file is one room at a time, and that part is tested as a
 * pure state machine. What was never covered is the routing itself: which paths
 * exist, and the origin check, which is a real security boundary and had only
 * been exercised as a pure function.
 */
import { describe, expect, it } from 'vitest';
import worker, { type Env } from './index';
import { PROTOCOL_VERSION, GAMES } from '../shared/rooms/protocol';

const LIVE = 'https://games.abbondanzo.com';
const PREVIEW = 'https://0fc473c3.games-ccu.pages.dev';

/** Only what the router touches; no request here reaches a room. */
const env = (over: Partial<Env> = {}): Env => ({
  ROOMS: {} as Env['ROOMS'],
  ALLOWED_ORIGINS: `${LIVE},https://*.games-ccu.pages.dev`,
  ...over,
});

const call = (path: string, init?: RequestInit, over?: Partial<Env>) =>
  worker.fetch(new Request(`https://rooms.test${path}`, init), env(over));

describe('the health endpoint', () => {
  it('answers, so an address that has never been deployed can be told apart', async () => {
    const response = await call('/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  /** The useful part: whether this room can talk to a given client at all. */
  it('says which protocol it speaks', async () => {
    const body = (await (await call('/health')).json()) as { protocol: number };
    expect(body.protocol).toBe(PROTOCOL_VERSION);
  });

  it('says which games it can run', async () => {
    const body = (await (await call('/health')).json()) as { games: string[] };
    expect(body.games).toEqual([...GAMES]);
  });

  it('names the upload behind it when the platform says', async () => {
    const version = { id: 'abc123', tag: 'deadbeef', timestamp: '2026-08-04T00:00:00Z' };
    const body = (await (await call('/health', undefined, { VERSION: version })).json()) as {
      version: string;
      commit: string;
      uploadedAt: string;
    };
    expect(body).toMatchObject({
      version: 'abc123',
      commit: 'deadbeef',
      uploadedAt: '2026-08-04T00:00:00Z',
    });
  });

  // Absent when running locally, and that should read as unknown, not crash.
  it('says nothing rather than failing when it is not told', async () => {
    const body = (await (await call('/health')).json()) as { version: null; commit: null };
    expect(body).toMatchObject({ version: null, commit: null });
  });

  // A diagnostic nobody can curl is not much of a diagnostic.
  it('answers any origin, and is not cached', async () => {
    const response = await call('/health', { headers: { Origin: 'https://somewhere.example' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('is one path, not a prefix', async () => {
    expect((await call('/health/secrets')).status).toBe(404);
  });
});

describe('the origin check', () => {
  it('lets the live site in', async () => {
    const response = await call('/rooms/NOPE', { headers: { Origin: LIVE } });
    expect(response.headers.get('access-control-allow-origin')).toBe(LIVE);
  });

  it('lets a preview in, since that is what the wildcard is for', async () => {
    const response = await call('/rooms/NOPE', { headers: { Origin: PREVIEW } });
    expect(response.headers.get('access-control-allow-origin')).toBe(PREVIEW);
  });

  it('turns another site away', async () => {
    const response = await call('/rooms/NOPE', { headers: { Origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  // Or a cache could hand one origin's answer to another.
  it('varies on the origin whether it allows it or not', async () => {
    for (const origin of [LIVE, 'https://evil.example']) {
      const response = await call('/rooms/NOPE', { headers: { Origin: origin } });
      expect(response.headers.get('vary')).toBe('Origin');
    }
  });

  it('answers a preflight without doing anything', async () => {
    const response = await call('/rooms', { method: 'OPTIONS', headers: { Origin: LIVE } });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('paths that are not there', () => {
  it.each(['/', '/anything', '/rooms/AB23/nonsense'])('refuses %s', async (path) => {
    expect((await call(path)).status).toBe(404);
  });

  /**
   * The code shape is checked here rather than in the room, because
   * `idFromName` will happily create an object for any string at all, which
   * would turn code guessing into an object-creation attack.
   */
  it.each([
    ['a code with a confusable in it', '/rooms/AB0D'],
    ['a code of the wrong length', '/rooms/AB2'],
    ['a code that is not a code', '/rooms/..%2F..'],
  ])('refuses %s before reaching a room', async (_label, path) => {
    expect((await call(path)).status).toBe(400);
  });

  it('refuses a socket path that is not an upgrade', async () => {
    expect((await call('/rooms/AB2D/socket')).status).toBe(426);
  });
});

/**
 * The join body, which was the last untrusted input here that met no schema.
 *
 * It matters more than it looks. A name is kept on the member and rebroadcast
 * to every device on every presence change, so an unbounded one is not a silly
 * display name - it is a room nobody can play in, for four hours, with no host
 * action that recovers it.
 */
describe('the join body', () => {
  const join = (body: unknown, raw?: string) =>
    call('/rooms/AB2D/join', {
      method: 'POST',
      headers: { Origin: LIVE, 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    });

  it.each([
    ['a name that is not a string', { name: 42 }],
    ['no name at all', { device: 'x' }],
    ['a name longer than the field allows', { name: 'A'.repeat(25) }],
    ['a device secret of absurd length', { name: 'Ada', device: 'x'.repeat(300) }],
    ['a claim that is not a string', { name: 'Ada', claim: { evil: true } }],
    ['nothing', null],
  ])('refuses %s', async (_label, body) => {
    expect((await join(body)).status).toBe(400);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await join(null, 'not json at all {')).status).toBe(400);
  });

  // The one that bricked a room: ~190 KB of name, ten times over.
  it('refuses a body far larger than any real one', async () => {
    const huge = JSON.stringify({ name: 'A'.repeat(200_000) });
    expect((await join(null, huge)).status).toBe(400);
  });

  it('refuses one that only says it is small', async () => {
    const response = await call('/rooms/AB2D/join', {
      method: 'POST',
      headers: { Origin: LIVE, 'content-length': '10' },
      body: JSON.stringify({ name: 'A'.repeat(200_000) }),
    });
    expect(response.status).toBe(400);
  });
});

describe('the create body', () => {
  const create = (body: unknown) =>
    call('/rooms', {
      method: 'POST',
      headers: { Origin: LIVE, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each([
    ['a game nobody plays', { game: 'chess', name: 'Ada' }],
    ['no game', { name: 'Ada' }],
    ['a name longer than the field allows', { game: 'cricket', name: 'A'.repeat(25) }],
  ])('refuses %s', async (_label, body) => {
    expect((await create(body)).status).toBe(400);
  });
});

/**
 * The socket upgrade answers with a different close code depending on whether
 * the room exists, which makes it an oracle. It cannot answer any other way -
 * the client needs to know - so the limit is the defence.
 */
describe('rate limiting', () => {
  const refusing = (): Env =>
    env({
      JOIN_LIMIT: { limit: async () => ({ success: false }) },
    } as Partial<Env>);

  it.each([
    ['creating a room', '/rooms', 'POST'],
    ['looking a code up', '/rooms/AB2D', 'GET'],
    ['joining', '/rooms/AB2D/join', 'POST'],
    ['opening a socket', '/rooms/AB2D/socket', 'GET'],
  ])('limits %s', async (_label, path, method) => {
    const response = await worker.fetch(
      new Request(`https://rooms.test${path}`, {
        method,
        headers: { Origin: LIVE, Upgrade: 'websocket' },
        body: method === 'POST' ? JSON.stringify({ game: 'cricket', name: 'Ada' }) : undefined,
      }),
      refusing(),
    );
    expect(response.status).toBe(429);
  });

  it('does not limit the health check', async () => {
    const response = await worker.fetch(new Request('https://rooms.test/health'), refusing());
    expect(response.status).toBe(200);
  });
});
