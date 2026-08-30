/**
 * The room server.
 *
 * Routing, origin checks and rate limiting live here, in the stateless Worker,
 * so that garbage never reaches a Durable Object: `idFromName` will happily
 * create one for any string, which would turn code enumeration into an
 * object-creation attack. Everything past this file is one room at a time.
 */
import { mintCode, normaliseCode } from '../shared/rooms/codes';
import { isAllowedOrigin, parseOrigins } from '../shared/rooms/origins';
import {
  CreateRequestSchema,
  GAMES,
  JoinRequestSchema,
  PROTOCOL_VERSION,
} from '../shared/rooms/protocol';

import { define } from './dictionary';

export { Room } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Optional: Cloudflare's rate limiter. Absent in local dev. */
  JOIN_LIMIT?: RateLimit;
  /** The same, for definitions, on its own budget so neither can starve the other. */
  DEFINE_LIMIT?: RateLimit;
  /**
   * Merriam-Webster's API key, set with `wrangler secret put DICTIONARY_KEY`.
   * Absent locally unless `.dev.vars` supplies one, in which case the Worker
   * serves no definitions - which costs a sentence and nothing else.
   */
  DICTIONARY_KEY?: string;
  /**
   * Which Merriam-Webster dictionary the key is subscribed to. A key is issued
   * per reference and is refused by every other one, so this belongs beside the
   * key rather than in code.
   */
  DICTIONARY_REFERENCE?: string;
  /** Comma-separated origins allowed to talk to this Worker. */
  ALLOWED_ORIGINS?: string;
  /** Which upload is running. Bound by Cloudflare; absent in local dev. */
  VERSION?: VersionMetadata;
}

interface VersionMetadata {
  id: string;
  tag?: string;
  timestamp?: string;
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Only used when `ALLOWED_ORIGINS` is missing, which should never happen: both
 * environments set it in `wrangler.toml`. It admits nothing but a machine
 * talking to itself, deliberately - a deploy that lost its configuration should
 * fail loudly rather than quietly let the whole web in.
 */
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

/** How many codes to try before admitting defeat. Collisions are vanishingly rare. */
const MINT_ATTEMPTS = 5;

const allowedOrigins = (env: Env): string[] => parseOrigins(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS);

const originAllowed = (request: Request, env: Env): boolean =>
  isAllowedOrigin(request.headers.get('Origin') ?? '', allowedOrigins(env));

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  // Vary regardless, or a cache could serve one origin's response to another.
  if (!originAllowed(request, env)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  });

/** The address someone is connecting from, bucketed so a single device cannot rotate. */
const rateKey = (request: Request): string => {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  // IPv6 to /48, not /64: a /64 is handed out per instance, so bucketing on
  // one makes the limit free to rotate past.
  return ip.includes(':')
    ? ip.split(':').slice(0, 3).join(':')
    : ip.split('.').slice(0, 3).join('.');
};

async function withinLimit(request: Request, env: Env): Promise<boolean> {
  if (!env.JOIN_LIMIT) return true; // not bound in local dev
  const { success } = await env.JOIN_LIMIT.limit({ key: rateKey(request) });
  return success;
}

async function withinDefineLimit(request: Request, env: Env): Promise<boolean> {
  if (!env.DEFINE_LIMIT) return true; // not bound in local dev
  const { success } = await env.DEFINE_LIMIT.limit({ key: rateKey(request) });
  return success;
}

/**
 * A definition never changes, and the free tier is 1000 lookups a day for the
 * whole account. Cached at the edge so a table arguing over the same word does
 * not spend the budget on it. Guarded because `caches` does not exist under a
 * test runner.
 */
const edgeCache = (): Cache | null =>
  typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;

/**
 * GET /define/:word - the definition, and only the definition.
 *
 * Validity is the client's own business, decided against a word list it ships
 * with, so every failure here is answered the same quiet way: no entries. The
 * bar shows a verdict either way and this only ever adds a sentence to it.
 */
async function defineWord(
  request: Request,
  env: Env,
  word: string,
  cors: Record<string, string>,
): Promise<Response> {
  const normalised = word.trim().toLowerCase();
  if (!/^[a-z'-]{1,32}$/.test(normalised)) return json({ error: 'bad-word' }, 400, cors);
  if (!(await withinDefineLimit(request, env))) return json({ error: 'rate-limited' }, 429, cors);
  if (!env.DICTIONARY_KEY) return json({ entries: [] }, 200, cors);

  const cache = edgeCache();
  const cacheKey = new Request(new URL(`/define/${normalised}`, request.url).toString());
  const hit = await cache?.match(cacheKey);
  if (hit) {
    // The cached copy carries no CORS headers of its own; they vary by origin.
    const body: unknown = await hit.json();
    return json(body, 200, cors);
  }

  let payload: unknown;
  try {
    payload = await define(normalised, env.DICTIONARY_KEY, env.DICTIONARY_REFERENCE);
  } catch (err) {
    // Opaque to the caller on purpose - a player must never be shown any of
    // this - but a rejected key and a dictionary that is merely down are the
    // same 502 from outside, and telling them apart is the difference between
    // a one-line fix and an afternoon. `wrangler tail` is where it goes.
    console.error('define failed:', normalised, err instanceof Error ? err.message : err);
    return json({ error: 'dictionary-unavailable' }, 502, cors);
  }

  await cache?.put(cacheKey, json(payload, 200, { 'cache-control': 'public, max-age=604800' }));
  return json(payload, 200, cors);
}

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    /**
     * Is this thing on, and which one is it?
     *
     * Every other route needs a room code, so without this the only way to tell
     * a Worker that is up from one that was never deployed is a 404 that looks
     * the same either way. `protocol` is the useful part: it says whether this
     * room can talk to a given client. Open to any origin, because a diagnostic
     * nobody can curl is not much of one.
     */
    if (url.pathname === '/health') {
      return json(
        {
          ok: true,
          protocol: PROTOCOL_VERSION,
          games: GAMES,
          // Whether the dictionary key actually landed. The secret is set out
          // of band, so without this the only symptom of a missing one is
          // definitions quietly never appearing.
          dictionary: Boolean(env.DICTIONARY_KEY),
          // Which dictionary the key is for. A key refused by every reference
          // but its own is the failure this makes visible without a log.
          reference: env.DICTIONARY_REFERENCE ?? null,
          version: env.VERSION?.id ?? null,
          // Workers Builds tags a version with the commit it was built from.
          commit: env.VERSION?.tag ?? null,
          uploadedAt: env.VERSION?.timestamp ?? null,
        },
        200,
        { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
      );
    }

    // WebSocket upgrades are not subject to CORS, so the origin is checked here
    // rather than relying on the browser. Without this any site could open a
    // socket to a room using a token it had somehow seen.
    const origin = request.headers.get('Origin');
    if (origin && !originAllowed(request, env)) {
      return json({ error: 'forbidden' }, 403, { vary: 'Origin' });
    }

    const parts = url.pathname.split('/').filter(Boolean);

    // GET /define/:word - definitions for the Scrabble drawer.
    if (parts[0] === 'define') {
      if (request.method !== 'GET' || parts.length !== 2) {
        return json({ error: 'not-found' }, 404, cors);
      }
      return defineWord(request, env, parts[1]!, cors);
    }

    if (parts[0] !== 'rooms') return json({ error: 'not-found' }, 404, cors);

    // POST /rooms - create
    if (parts.length === 1 && request.method === 'POST') {
      return createRoom(request, env, cors);
    }

    const code = parts[1] ? normaliseCode(parts[1]) : null;
    if (!code) return json({ error: 'bad-code' }, 400, cors);

    // GET /rooms/:code - peek, so a deep link knows which game to open and who
    // is waiting to be claimed. It names people, so it is rate limited too.
    if (parts.length === 2 && request.method === 'GET') {
      if (!(await withinLimit(request, env))) {
        return json({ error: 'rate-limited' }, 429, cors);
      }
      return forward(env, code, 'peek', cors);
    }

    // POST /rooms/:code/join
    if (parts[2] === 'join' && request.method === 'POST') {
      if (!(await withinLimit(request, env))) {
        return json({ error: 'rate-limited' }, 429, cors);
      }
      // Parsed and rebuilt here rather than passed through, so the room only
      // ever sees a body of the shape and size it expects.
      const body = JoinRequestSchema.safeParse(await readJson(request));
      if (!body.success) return json({ error: 'bad-message' }, 400, cors);
      return forward(env, code, 'join', cors, JSON.stringify(body.data));
    }

    // GET /rooms/:code/socket - upgrade
    if (parts[2] === 'socket') {
      // Limited like everything else. Without this the close code is a free
      // oracle for whether a room exists, and the whole code space is small.
      if (!(await withinLimit(request, env))) {
        return json({ error: 'rate-limited' }, 429, cors);
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ error: 'expected-websocket' }, 426, cors);
      }
      const target = new URL(request.url);
      target.searchParams.set('do', 'socket');
      return roomStub(env, code).fetch(new Request(target, request));
    }

    return json({ error: 'not-found' }, 404, cors);
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env, cors: Record<string, string>) {
  if (!(await withinLimit(request, env))) return json({ error: 'rate-limited' }, 429, cors);

  const parsed = CreateRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'bad-game' }, 400, cors);
  const { game, name, device } = parsed.data;

  // A room exists at a code or it does not, and the room itself is the only
  // thing that knows, so there is no separate registry to fall out of step.
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const code = mintCode();
    const response = await roomStub(env, code).fetch(
      new Request(`https://room/?do=create`, {
        method: 'POST',
        body: JSON.stringify({ code, game, name, device }),
      }),
    );
    if (response.status !== 409) return withCors(response, cors);
  }
  return json({ error: 'no-code-available' }, 503, cors);
}

/** Bodies are capped well under any real one, so a huge one is not even read. */
const MAX_BODY_BYTES = 4 * 1024;

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;

  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function forward(
  env: Env,
  code: string,
  action: string,
  cors: Record<string, string>,
  body?: string,
) {
  const response = await roomStub(env, code).fetch(
    new Request(`https://room/?do=${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      body,
    }),
  );
  return withCors(response, cors);
}

function withCors(response: Response, cors: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
