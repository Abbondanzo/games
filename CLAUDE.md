# Working in this repo

Score trackers for Scrabble, cricket darts and Rummikub. React 18 + TypeScript + Vite,
deployed to Cloudflare Pages. Solo play is entirely offline in the browser; shared rooms are
served by a Cloudflare Worker.

```
pnpm install
pnpm dev          # dev server
pnpm test         # vitest, run once
pnpm typecheck    # tsc -b --noEmit
pnpm build        # tsc -b && vite build
pnpm icons        # regenerate public/ icons from the trophy artwork
```

## Architecture

Three top-level directories, split by what can run where:

```
shared/     pure domain, imported by both the app and the Worker. No React, no DOM.
  ids.ts
  games/<game>/   types.ts, rules, reducer.ts, schema.ts
  rooms/          protocol.ts, permissions.ts, roomCore.ts, codes.ts, games/<game>.ts
src/        the React app
  <game>/   <Game>Tracker.tsx, components/, lib/use<Game>.ts (hook + storage)
  shared/   Home.tsx, PlayersCard.tsx
worker/     the room server: a Cloudflare Worker with a Durable Object per room
```

Import shared code as `@shared/...`; the alias is declared in `tsconfig.app.json` and
`vite.config.ts`. **Anything needed by both sides lives in `shared/` and is imported, never
copied.** That is why the game reducers are there: the room server runs them.

`shared/` must stay free of React and browser APIs. `localStorage` reads live in the hooks under
`src/<game>/lib/`, not in the reducers, for exactly this reason.

**Rules live in plain functions with no React.** That is the main structural rule here. It means
the maths is testable without rendering anything, and it keeps the trackers thin.

**State is derived, not stored.** Reducers store only raw events - words played, darts thrown,
rounds won - and scores are computed by replaying them. Cricket is the clearest case: whether a
dart pays depends on who had closed what at the moment it landed, so `computeBoard` replays the
whole game. This is why switching cricket modes rescores rather than restarts, and why removing
a player recalculates cleanly.

The flip side is that anything affecting the replay must be modelled explicitly. Cricket players
carry `joinedAtTurn` for exactly this reason: without it a player added mid-game would count as
an opponent for darts thrown before they existed.

## Conventions

- **Plain hyphens.** No em or en dashes anywhere. Enforced by a test in `App.test.tsx` that
  scans the source.
- **No emoji.** Same test. Icons come from `lucide-react`, or are purpose-drawn SVG.
- **Comments explain why, not what.** Prefer none over restating the code.
- **Validate untrusted input with zod**, never with hand-rolled guards or casts. Schemas live
  next to the type they describe in `shared/`, are used by both sides, and strip unknown keys,
  so what comes out of a parse is exactly what was declared. Types are inferred with `z.infer`
  so a schema and its type cannot drift.
- **Accessible names must be distinct.** Two buttons reading "Ada" is a bug; a UI test caught
  exactly that in Rummikub, hence `aria-label="Enter tiles for Ada"`.
- **Player-facing copy carries no jargon** - no status codes, no networking terms. Enforced by a
  guard in `dictionary.test.ts`.

## Untrusted input

Three places take input nobody vouches for: a stored game out of `localStorage`, a frame off a
socket, and a game action inside that frame. All three go through zod.

The action case is the subtle one. The protocol only checks that an action has a `type`; the
payload belongs to the game that owns it, so each game has a `schema.ts` with its own action
union. Without that, `{ type: 'addPlayers', names: 42 }` would reach `names.split(',')` and
throw inside the room.

## Testing

`pnpm test` runs everything under jsdom. Around 600 tests across three layers:

1. **Rules** (`<game>.test.ts`) - pure functions, table-driven where it helps.
2. **Reducers** (`use<Game>.test.ts`) - actions in, state out, no rendering.
3. **Trackers** (`<Game>Tracker.test.tsx`) - Testing Library, driving the real UI.

Plus `App.test.tsx` (routing, house-style guards), `pwa.test.ts` (manifest, icons, iOS tags),
and the rooms tests. Three of those earn their keep: `twoClients.test.tsx` and
`rummikubRoom.test.tsx` render a host and a guest side by side against a real room in-process,
and `shared/rooms/games/parity.test.ts` runs the same script through the plain reducer and
through the room and demands identical results, so the longer road a room action takes cannot
quietly change the game.

Query by role and accessible name, not test ids - the one exception is a couple of live-total
readouts. When fixing a bug, add the regression test with a comment naming the failure, and make
it fail first.

## Gotchas

- **Dictionary 5xx is not a verdict.** The upstream returns sporadic `502`s unrelated to the
  word. Only `200` and `404` mean anything; everything else retries and, if it never resolves,
  shows an amber "could not check" rather than "not a word". Never collapse those two states.
- **`base` is `/`, not relative.** The service worker and manifest are scoped to the origin
  root, so subpath hosting will not work.
- **pnpm 11 blocks dependency build scripts.** `pnpm-workspace.yaml` has `allowBuilds: esbuild`.
  Without it install exits non-zero, which breaks `test` and `typecheck` too, since pnpm re-runs
  install before every script. The old `onlyBuiltDependencies` key is silently ignored.
- **A deploy does not reach open tabs.** The app is precached, so the page keeps running the code
  it loaded until it reloads. `UpdatePrompt` offers that; the service worker waits for the tap
  rather than swapping silently. When something new "does not work", check the client is current
  before debugging it - that has been the answer twice.
- **Icons are committed.** Regenerate with `pnpm icons` after changing the artwork; nothing
  rasterises at build time.
- **CI does not gate deployment.** Cloudflare Pages builds from the repo independently, so a red
  CI run still ships. See `docs/deployment.md`.
- **The room is the authority, not the host.** Clients send requests and render
  what comes back; only the room runs a reducer. A guest gets no optimistic update, because it
  cannot mint the same ids.
- **Solo play must never touch the network.** There is a test asserting no WebSocket is
  constructed and that storage is still written. Keep it passing.
- **A browser is never told why a socket would not open.** A refused upgrade is
  indistinguishable from a lost connection, so a room that is gone has to say so *on* the
  socket: it accepts the connection purely to close it with a code from `CLOSE`. Returning a
  404 instead means clients retry a dead room forever. See `docs/rooms.md`.
- **Anything that ends a room must put the local game back first.** Clearing the session makes
  the solo persist effect fire, and it writes whatever is in state - which is the room's game
  unless the host owns it. `stopFollowing` in `session.ts` is the one way out; use it.
- **Deploy the Worker before the client.** They deploy separately and the app is precached, so a
  client can be weeks old. Server-to-client additions are safe; a new *client-to-server* message
  is not, because an old room rejects a frame it has never heard of and the button just appears
  broken. Bump `PROTOCOL_VERSION` for either, so the mismatch names itself.
- **Storage keys are `games.<game>.v1`.** Changing one discards saved games, so version them
  rather than renaming.

## Docs

Per-game rules and behaviour live in `docs/`: [scrabble](docs/scrabble.md),
[cricket](docs/cricket.md), [rummikub](docs/rummikub.md). Also
[docs/rooms.md](docs/rooms.md), [docs/pwa.md](docs/pwa.md) and
[docs/deployment.md](docs/deployment.md).
