# Working in this repo

Score trackers for Scrabble, cricket darts and Rummikub. React 18 + TypeScript + Vite, no
backend, everything in the browser. Deployed to Cloudflare Pages.

```
pnpm install
pnpm dev          # dev server
pnpm test         # vitest, run once
pnpm typecheck    # tsc -b --noEmit
pnpm build        # tsc -b && vite build
pnpm icons        # regenerate public/ icons from the trophy artwork
```

## Architecture

Every game is a self-contained module under `src/<game>/` with the same shape:

```
src/<game>/
  <Game>Tracker.tsx     page component, owns the in-progress entry
  components/           presentational pieces
  lib/
    <game>.ts           pure rules, no React
    use<Game>.ts        reducer + localStorage persistence
    types.ts
```

`src/shared/` holds what is common: `Home.tsx` (the game list) and `PlayersCard.tsx` (add and
remove players, used by all three). `src/App.tsx` routes, `src/index.css` is all the styling.

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
- **Accessible names must be distinct.** Two buttons reading "Ada" is a bug; a UI test caught
  exactly that in Rummikub, hence `aria-label="Enter tiles for Ada"`.
- **Player-facing copy carries no jargon** - no status codes, no networking terms. Enforced by a
  guard in `dictionary.test.ts`.

## Testing

`pnpm test` runs everything under jsdom. Around 260 tests across three layers:

1. **Rules** (`<game>.test.ts`) - pure functions, table-driven where it helps.
2. **Reducers** (`use<Game>.test.ts`) - actions in, state out, no rendering.
3. **Trackers** (`<Game>Tracker.test.tsx`) - Testing Library, driving the real UI.

Plus `App.test.tsx` (routing, house-style guards) and `pwa.test.ts` (manifest, icons, iOS tags).

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
- **Icons are committed.** Regenerate with `pnpm icons` after changing the artwork; nothing
  rasterises at build time.
- **CI does not gate deployment.** Cloudflare Pages builds from the repo independently, so a red
  CI run still ships. See `docs/deployment.md`.
- **Storage keys are `games.<game>.v1`.** Changing one discards saved games, so version them
  rather than renaming.

## Docs

Per-game rules and behaviour live in `docs/`: [scrabble](docs/scrabble.md),
[cricket](docs/cricket.md), [rummikub](docs/rummikub.md). Also
[docs/pwa.md](docs/pwa.md) and [docs/deployment.md](docs/deployment.md).
