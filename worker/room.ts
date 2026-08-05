/**
 * One Durable Object per room.
 *
 * Deliberately thin. Every decision about who may do what, and what a message
 * means, lives in shared/rooms/roomCore.ts, which is a pure function and is
 * tested without any of this. What is left here is the part that can only be
 * done against the platform: sockets, storage, alarms and hibernation.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  connect, createRoom, disconnect, handle, join,
  type Effect, type RoomState,
} from '../shared/rooms/roomCore';
import { CLOSE, decodeClientMessage, encode, type Game } from '../shared/rooms/protocol';
import { GAME_SETUP } from '../shared/rooms/games';
import { claimable } from '../shared/rooms/roomCore';
import type { ApplyAction } from '../shared/rooms/roomCore';
import type { Snapshot } from '../shared/rooms/protocol';

/** A room with no traffic at all for this long is deleted, freeing its code. */
const IDLE_MS = 4 * 60 * 60 * 1000;

/** A socket may send this many messages a second before it is told to slow down. */
const MESSAGE_BUDGET = 20;

const STORAGE_KEY = 'room';

interface Attachment {
  memberId: string;
  /** Timestamps of recent messages, for the per-socket budget. */
  recent: number[];
}

const uid = () => crypto.randomUUID();

/**
 * A device's secret, as the room stores it.
 *
 * Hashed so the stored room holds nothing that could be replayed if the storage
 * were ever read. The digest is only ever compared with another digest, and
 * never leaves the room in any form.
 */
async function deviceKeyOf(secret: unknown): Promise<string | null> {
  if (typeof secret !== 'string' || !secret) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class Room extends DurableObject {
  /**
   * Held only for the life of one request. Hibernation wipes memory, so the
   * room is always read from storage rather than trusted from a field.
   */
  private async load(): Promise<RoomState | null> {
    return (await this.ctx.storage.get<RoomState>(STORAGE_KEY)) ?? null;
  }

  private async save(state: RoomState): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, state);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  /** Live member ids, derived from the sockets rather than stored. */
  private online(): string[] {
    return this.ctx.getWebSockets()
      .map((ws) => (ws.deserializeAttachment() as Attachment | null)?.memberId)
      .filter((id): id is string => typeof id === 'string');
  }

  private applyFor(game: Game): ApplyAction<Snapshot> {
    return GAME_SETUP[game].apply(uid);
  }

  private dispatch(effects: Effect[]): void {
    if (!effects.length) return;
    const sockets = this.ctx.getWebSockets();
    const byMember = new Map<string, WebSocket[]>();
    for (const ws of sockets) {
      const id = (ws.deserializeAttachment() as Attachment | null)?.memberId;
      if (!id) continue;
      byMember.set(id, [...(byMember.get(id) ?? []), ws]);
    }

    for (const effect of effects) {
      if (effect.to === 'all') {
        const payload = encode(effect.message);
        for (const ws of sockets) trySend(ws, payload);
      } else if (effect.to === 'member') {
        const payload = encode(effect.message);
        for (const ws of byMember.get(effect.memberId) ?? []) trySend(ws, payload);
      } else if (effect.to === 'close') {
        for (const ws of byMember.get(effect.memberId) ?? []) ws.close(CLOSE.removed, 'removed');
      } else {
        for (const ws of sockets) ws.close(CLOSE.ended, 'room closed');
      }
    }
  }

  /* ─────────────────────────── HTTP ─────────────────────────── */

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('do');

    if (action === 'create') return this.handleCreate(request);
    if (action === 'join') return this.handleJoin(request);
    if (action === 'peek') return this.handlePeek();
    if (action === 'socket') return this.handleSocket(url);
    return json({ error: 'not-found' }, 404);
  }

  private async handleCreate(request: Request): Promise<Response> {
    // A room already at this code means the mint collided; the caller retries.
    if (await this.load()) return json({ error: 'taken' }, 409);

    const body = (await request.json()) as {
      code: string; game: Game; name: string; device?: unknown;
    };
    const memberId = uid();
    const token = uid();

    const state = createRoom({
      code: body.code,
      game: body.game,
      host: { memberId, name: body.name, deviceKey: await deviceKeyOf(body.device) ?? undefined },
      snapshot: GAME_SETUP[body.game].initial(),
      now: Date.now(),
      apply: this.applyFor(body.game),
    });

    await this.ctx.storage.put('tokens', { [token]: memberId });
    await this.save(state);
    return json({ code: body.code, token, memberId, game: body.game });
  }

  private async handleJoin(request: Request): Promise<Response> {
    // Read before touching storage. Awaiting the body reopens the input gate,
    // so a load either side of it can be overwritten by a join that arrived in
    // between - which drops a member whose token has already been filed, and
    // tells them they were removed by a host who did nothing of the kind.
    const body = (await request.json()) as {
      name: string; device?: unknown; claim?: unknown;
    };
    const deviceKey = await deviceKeyOf(body.device);

    const state = await this.load();
    if (!state) return json({ error: 'no-room' }, 404);

    const memberId = uid();
    const token = uid();

    const result = join(
      state,
      {
        memberId,
        name: body.name,
        now: Date.now(),
        // Who this device already is, if the room has met it. Unguessable, so
        // an absent or invented one simply means a new player.
        deviceKey,
        // Or a row the host laid out that this joiner says is them. Checked
        // against what is actually claimable, so a stale one falls through.
        claim: typeof body.claim === 'string' ? body.claim : null,
      },
      this.applyFor(state.game),
    );
    if (!result.ok) return json({ error: result.code }, result.code === 'kicked-out' ? 403 : 409);

    const tokens = (await this.ctx.storage.get<Record<string, string>>('tokens')) ?? {};
    await this.ctx.storage.put('tokens', { ...tokens, [token]: memberId });
    await this.save(result.state);
    // A device rejoining replaces the member it had, so that one's token goes.
    if (result.effects.some((e) => e.to === 'close')) await this.forgetTokens(result.state);
    // Joining adds a player, so whoever is already connected needs to see it.
    this.dispatch(result.effects);

    return json({ code: state.code, token, memberId, game: state.game });
  }

  private async handlePeek(): Promise<Response> {
    const state = await this.load();
    if (!state) return json({ error: 'no-room' }, 404);
    // The rows a host laid out in advance, so a joiner can say which is them
    // before typing a name. Only ever the unspoken-for ones.
    return json({
      game: state.game,
      open: !state.locked,
      claimable: claimable(state).map(({ id, name }) => ({ id, name })),
    });
  }

  private async handleSocket(url: URL): Promise<Response> {
    const state = await this.load();
    if (!state) return refuse(CLOSE.ended);

    const token = url.searchParams.get('t') ?? '';
    const tokens = (await this.ctx.storage.get<Record<string, string>>('tokens')) ?? {};
    const memberId = tokens[token];
    // A kicked member's entry is gone from the room even though the token remains.
    if (!memberId || !state.members[memberId]) return refuse(CLOSE.removed);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Identity rides on the socket, set during the upgrade, so a hibernated
    // room still knows who is on the other end without any in-memory map.
    server.serializeAttachment({ memberId, recent: [] } satisfies Attachment);
    this.ctx.acceptWebSocket(server);

    const outcome = connect(state, memberId, { online: this.online(), now: Date.now() });
    await this.save(outcome.state);
    this.dispatch(outcome.effects);

    return new Response(null, { status: 101, webSocket: client });
  }

  /* ─────────────────────────── sockets ─────────────────────────── */

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return;

    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) return ws.close(CLOSE.unauthorised, 'unauthorised');

    if (!this.withinBudget(ws, attachment)) {
      return trySend(ws, encode({ t: 'error', reqId: null, code: 'rate-limited' }));
    }

    const message = decodeClientMessage(raw);
    if (!message) {
      return trySend(ws, encode({ t: 'error', reqId: null, code: 'bad-message' }));
    }

    const state = await this.load();
    if (!state) return ws.close(CLOSE.ended, 'room gone');

    const outcome = handle(
      state,
      attachment.memberId,
      message,
      { online: this.online(), now: Date.now() },
      this.applyFor(state.game),
    );

    // Kicking or leaving removes the member, so the token goes with them.
    if (message.t === 'kick' || message.t === 'leave') await this.forgetTokens(outcome.state);

    // Say it is over before the room goes away, then free the code.
    if (outcome.effects.some((e) => e.to === 'shutdown')) {
      this.dispatch(outcome.effects);
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.save(outcome.state);
    this.dispatch(outcome.effects);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    const state = await this.load();
    if (!state || !attachment) return;

    // The socket is still listed until this handler returns, so exclude it.
    const online = this.online().filter((id, i, all) =>
      id !== attachment.memberId || all.indexOf(id) !== i);
    this.dispatch(disconnect(state, attachment.memberId, { online, now: Date.now() }).effects);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** Drops any token whose member is no longer in the room. */
  private async forgetTokens(state: RoomState): Promise<void> {
    const tokens = (await this.ctx.storage.get<Record<string, string>>('tokens')) ?? {};
    const kept = Object.fromEntries(
      Object.entries(tokens).filter(([, memberId]) => state.members[memberId]),
    );
    await this.ctx.storage.put('tokens', kept);
  }

  private withinBudget(ws: WebSocket, attachment: Attachment): boolean {
    const now = Date.now();
    const recent = [...attachment.recent.filter((t) => now - t < 1000), now];
    ws.serializeAttachment({ ...attachment, recent } satisfies Attachment);
    return recent.length <= MESSAGE_BUDGET;
  }

  /**
   * Nothing has happened for hours. Wiping storage also frees the code for
   * reuse, so expiry and the code registry are the same mechanism.
   */
  override async alarm(): Promise<void> {
    const state = await this.load();
    if (state && Date.now() - state.lastActiveAt < IDLE_MS) {
      await this.ctx.storage.setAlarm(state.lastActiveAt + IDLE_MS);
      return;
    }
    for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE.ended, 'room expired');
    await this.ctx.storage.deleteAll();
  }
}

/**
 * Turns a socket away with a reason.
 *
 * Refusing the upgrade outright would be simpler, but a browser does not pass
 * the status on: the client sees only that the socket failed, which is what a
 * lost connection looks like too, so it retries a room that no longer exists
 * forever. Accepting the socket purely to close it with a code is the only way
 * to say why.
 */
function refuse(code: number): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].close(code);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/** A closing socket throws on send; that is not worth failing the whole broadcast for. */
function trySend(ws: WebSocket, payload: string): void {
  try {
    ws.send(payload);
  } catch {
    // The socket is going away; the close handler will tidy up.
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
