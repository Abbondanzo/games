# Working in this repo

Score trackers for Scrabble, cricket darts, Rummikub and Yahtzee. React 18 + TypeScript + Vite,
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
  games/players.ts  roster rules every game shares
  games/<game>/     types.ts, rules, reducer.ts, schema.ts
  rooms/            protocol.ts, permissions.ts, roomCore.ts, codes.ts
  rooms/games/      adapter.ts (the one adapter), index.ts (the registry), <game>.ts
src/        the React app
  <game>/   <Game>Tracker.tsx, components/, lib/use<Game>.ts (hook + storage)
  rooms/    whoAmI.ts, RoomStrip.tsx, WhoseTurn.tsx, session.ts, transport.ts
  shared/   Home.tsx, Settings.tsx, PlayersCard.tsx, theme.ts, localStore.ts
worker/     the room server: a Cloudflare Worker with a Durable Object per room
```

**Ask the shared helpers rather than working it out again.** Three trackers each
deriving the same thing is how they drift, and the drift is always in the case nobody
thought about:

- `src/rooms/whoAmI.ts` - am I the host, is it my turn, which player am I, is this
  control closed off (`blocked`) or not on offer at all (`allowed`). Every one has to
  answer for a solo game where there is no room, which is the part that was going wrong.
- `src/shared/localStore.ts` - guarded `localStorage`. It throws rather than returning
  null when a browser has storage off, and nothing in a test run ever throws.
- `shared/games/players.ts` - name parsing, renaming, and where the turn pointer goes
  when a player leaves.
- `shared/rooms/games/index.ts` - the one registry of games the room can run, imported
  by the Worker and the test room. Adding a game means adding it here, once.

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

- **No manual line wrapping in prose Claude writes** - PR descriptions, commit bodies, and
  markdown files. Write paragraphs as unwrapped lines and let the rendering platform (GitHub)
  soft-wrap them; a hard-wrapped line looks awkward once GitHub's own wrap width differs from
  the one chosen when it was written. Code blocks, tables, and lists are unaffected.
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
- **Hide what a person may never do; disable what they may not do yet.** A control whose only
  answer is "only the host can do that" should not be on screen. One that will work when it is
  their turn should be disabled and say so. `allowed` and `blocked` in `whoAmI.ts` are the two
  halves of that.
- **Player-facing copy carries no jargon** - no status codes, no networking terms. Enforced by a
  guard in `dictionary.test.ts`.

## Untrusted input

Four places take input nobody vouches for: a stored game out of `localStorage`, a frame off a
socket, a game action inside that frame, and the body of a join or create request. All four go
through zod, and the join body is validated at the Worker's front door before it is forwarded to
a room - it was not, and an unbounded name is not a silly display name but a room nobody can
play in, since names are kept on the member and rebroadcast on every presence change.

The action case is the subtle one. The protocol only checks that an action has a `type`; the
payload belongs to the game that owns it, so each game has a `schema.ts` with its own action
union. Without that, `{ type: 'addPlayers', names: 42 }` would reach `names.split(',')` and
throw inside the room.

## Testing

`pnpm test` runs everything under jsdom. Around 1,100 tests across three layers:

1. **Rules** (`<game>.test.ts`) - pure functions, table-driven where it helps.
2. **Reducers** (`use<Game>.test.ts`) - actions in, state out, no rendering.
3. **Trackers** (`<Game>Tracker.test.tsx`) - Testing Library, driving the real UI.

Room tests build their clients with `src/rooms/testClient.tsx` - `mountClient`, `mountPair`,
`scoreboard`, `countingSockets` - the other half of `testRoom.ts`. Use it rather than writing
another render wrapper.

Plus `App.test.tsx` (routing, house-style guards), `pwa.test.ts` (manifest, icons, iOS tags),
and the rooms tests. Three of those earn their keep: `twoClients.test.tsx` and
`rummikubRoom.test.tsx` render a host and a guest side by side against a real room in-process,
and `shared/rooms/games/parity.test.ts` runs the same script through the plain reducer and
through the room and demands identical results, so the longer road a room action takes cannot
quietly change the game.

Query by role and accessible name, not test ids. Two exceptions, both deliberate: a couple of
live-total readouts, and the scoreboard readers in `testClient.tsx`, where a row has no
accessible structure separating the name from the score. Keep that exception in that file. When fixing a bug, add the regression test with a comment naming the failure, and make
it fail first.

## Gotchas

- **Dictionary 5xx is not a verdict.** The upstream returns sporadic `502`s unrelated to the
  word. Only `200` and `404` mean anything; everything else retries and, if it never resolves,
  shows an amber "could not check" rather than "not a word". Never collapse those two states.
- **A dictionary request needs a deadline, and every lookup needs an owner.** The upstream also
  accepts a connection and then never answers, which no amount of retrying escapes: `retryConfig`
  bounds one attempt and the lookup as a whole. And a lookup outlives the word it was about, so
  `src/scrabble/lib/useLookup.ts` is the only way to start one - it cancels the request in flight
  whenever the word moves on, which is what stops a stale verdict landing on a later turn.
- **`base` is `/`, not relative.** The service worker and manifest are scoped to the origin
  root, so subpath hosting will not work.
- **pnpm 11 blocks dependency build scripts.** `pnpm-workspace.yaml` has `allowBuilds: esbuild`.
  Without it install exits non-zero, which breaks `test` and `typecheck` too, since pnpm re-runs
  install before every script. The old `onlyBuiltDependencies` key is silently ignored.
- **A deploy does not reach open tabs.** The app is precached, so the page keeps running the code
  it loaded until it reloads. `UpdatePrompt` offers that; the service worker waits for the tap
  rather than swapping silently. When something new "does not work", check the client is current
  before debugging it - that has been the answer twice.
- **A deploy replaces every hashed filename.** A browser holding the previous `index.html` asks
  for a file that is gone, Pages answers with HTML, and the page is blank with a MIME error.
  `public/_headers`, `navigateFallbackDenylist` and the recovery script in `index.html` are three
  halves of the same fix; `pwa.test.ts` guards all three. See `docs/deployment.md`.
- **Icons are committed.** Regenerate with `pnpm icons` after changing the artwork; nothing
  rasterises at build time.
- **CI does not gate deployment.** Cloudflare Pages builds from the repo independently, so a red
  CI run still ships. See `docs/deployment.md`.
- **There is one room server, and a pull request preview talks to it.** A room made from a
  preview is a real room, in the same storage as everybody's live games. There is no staging
  copy: a second one costs a second Workers Builds project and a second build per push. To try
  anything that writes to a room, run the server - `pnpm worker:dev`, then
  `VITE_ROOMS_URL=http://localhost:8787 pnpm dev`.
- **A preview cannot exercise a protocol change.** The preview client is ahead of the deployed
  room, so it can only ever show the version banner. Run it locally, or deploy the Worker first.
  Two attempts at a per-branch room server are written up in `docs/rooms.md`; do not try a third.
- **`GET /health` says whether a room server is up and what it speaks.** Every other route needs
  a room code, so it is the only way to tell a live address from one that was never deployed.
- **The room is the authority, not the host.** Clients send requests and render
  what comes back; only the room runs a reducer. A guest gets no optimistic update, because it
  cannot mint the same ids.
- **Solo play must never touch the network.** There is a test asserting no WebSocket is
  constructed and that storage is still written. Keep it passing.
- **A browser is never told why a socket would not open.** A refused upgrade is
  indistinguishable from a lost connection, so a room that is gone has to say so _on_ the
  socket: it accepts the connection purely to close it with a code from `CLOSE`. Returning a
  404 instead means clients retry a dead room forever. See `docs/rooms.md`.
- **Anything that ends a room must put the local game back first.** Clearing the session makes
  the solo persist effect fire, and it writes whatever is in state - which is the room's game
  unless the host owns it. `stopFollowing` in `session.ts` is the one way out; use it.
- **Deploy the Worker before the client.** They deploy separately and the app is precached, so a
  client can be weeks old. Server-to-client additions are safe; a new _client-to-server_ message
  is not, because an old room rejects a frame it has never heard of and the button just appears
  broken. Bump `PROTOCOL_VERSION` for either, so the mismatch names itself.
- **Every route is rate limited except `/health`.** The socket upgrade included: its close code
  says whether a room exists, which makes it an enumeration oracle, and it cannot answer any
  other way because the client needs to know.
- **A room recognises a device, never a name.** Names are public, typeable by anyone, and
  changeable by their owner, so nothing may key off them. Each device keeps a secret per room
  code; the room stores `sha256(secret) -> seatId` in `RoomState.devices` and hands the player
  back to whoever presents it. It goes in the join body over HTTPS and nowhere else - never over
  the socket, never in `roomView`, and the closed message schemas mean a leak would be stripped
  by the client's own decode. Do not reintroduce name matching; it was there, it was spoofable,
  and it did not even work for two people called Peter.
- **Locking lets a returning device back in but not a new one.** Being removed is separate and
  lasts the game: it is keyed on the device, survives the door being unlocked, and the host is
  shown the list and can undo it. Kicking deliberately does not lock the room any more.
- **A player is claimable only while no device has ever held it.** That is what lets a host lay
  the table out in advance and have people take their rows, without letting anybody take a row
  that is already somebody's. `claimable()` in `roomCore.ts` is the one definition.
- **Play order is fixed by the first turn.** `movePlayer` is refused once a game has any
  turns, because the roster order is the turn order and moving somebody would hand the turn
  to a different player. The UI hides the buttons then, but the reducer is what enforces it.
- **An action that names a player is checked against the seat, not just the turn.** Scrabble and
  cricket score whoever is up implicitly, so being up was the whole check. Yahtzee names the
  player, because the host fills in for whoever calls a score out - and without the extra check
  in `permit`, a guest on their own turn could write on somebody else's sheet.
- **Storage keys are `games.<game>.v1`.** Changing one discards saved games, so version them
  rather than renaming.

## Docs

Per-game rules and behaviour live in `docs/`: [scrabble](docs/scrabble.md),
[cricket](docs/cricket.md), [rummikub](docs/rummikub.md), [yahtzee](docs/yahtzee.md). Also
[docs/rooms.md](docs/rooms.md), [docs/pwa.md](docs/pwa.md) and
[docs/deployment.md](docs/deployment.md).
