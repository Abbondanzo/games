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
import { GAMES, PROTOCOL_VERSION, type Game } from '../shared/rooms/protocol';

export { Room } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /** Optional: Cloudflare's rate limiter. Absent in local dev. */
  JOIN_LIMIT?: RateLimit;
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
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
];

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
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip.split('.').slice(0, 3).join('.');
};

async function withinLimit(request: Request, env: Env): Promise<boolean> {
  if (!env.JOIN_LIMIT) return true; // not bound in local dev
  const { success } = await env.JOIN_LIMIT.limit({ key: rateKey(request) });
  return success;
}

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

const isGame = (value: string | null): value is Game =>
  value !== null && (GAMES as readonly string[]).includes(value);

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
      return json({
        ok: true,
        protocol: PROTOCOL_VERSION,
        games: GAMES,
        version: env.VERSION?.id ?? null,
        // Workers Builds tags a version with the commit it was built from.
        commit: env.VERSION?.tag ?? null,
        uploadedAt: env.VERSION?.timestamp ?? null,
      }, 200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    }

    // WebSocket upgrades are not subject to CORS, so the origin is checked here
    // rather than relying on the browser. Without this any site could open a
    // socket to a room using a token it had somehow seen.
    const origin = request.headers.get('Origin');
    if (origin && !originAllowed(request, env)) {
      return json({ error: 'forbidden' }, 403, { vary: 'Origin' });
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'rooms') return json({ error: 'not-found' }, 404, cors);

    // POST /rooms - create
    if (parts.length === 1 && request.method === 'POST') {
      return createRoom(request, env, cors);
    }

    const code = parts[1] ? normaliseCode(parts[1]) : null;
    if (!code) return json({ error: 'bad-code' }, 400, cors);

    // GET /rooms/:code - peek, so a deep link knows which game to open
    if (parts.length === 2 && request.method === 'GET') {
      return forward(env, code, 'peek', cors);
    }

    // POST /rooms/:code/join
    if (parts[2] === 'join' && request.method === 'POST') {
      if (!(await withinLimit(request, env))) {
        return json({ error: 'rate-limited' }, 429, cors);
      }
      return forward(env, code, 'join', cors, request);
    }

    // GET /rooms/:code/socket - upgrade
    if (parts[2] === 'socket') {
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

  const body = (await request.json().catch(() => null)) as { game?: string; name?: string } | null;
  if (!isGame(body?.game ?? null)) return json({ error: 'bad-game' }, 400, cors);
  const game = body!.game as Game;
  const name = typeof body?.name === 'string' ? body.name.slice(0, 24) : 'Host';

  // A room exists at a code or it does not, and the room itself is the only
  // thing that knows, so there is no separate registry to fall out of step.
  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    const code = mintCode();
    const response = await roomStub(env, code).fetch(
      new Request(`https://room/?do=create`, {
        method: 'POST',
        body: JSON.stringify({ code, game, name }),
      }),
    );
    if (response.status !== 409) return withCors(response, cors);
  }
  return json({ error: 'no-code-available' }, 503, cors);
}

async function forward(
  env: Env,
  code: string,
  action: string,
  cors: Record<string, string>,
  request?: Request,
) {
  const body = request ? await request.text() : undefined;
  const response = await roomStub(env, code).fetch(
    new Request(`https://room/?do=${action}`, {
      method: request ? request.method : 'GET',
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
