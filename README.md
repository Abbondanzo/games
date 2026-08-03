# Games

Score trackers for the games I actually play. React + TypeScript, no backend - everything runs
in the browser, saves to `localStorage`, and works offline.

**[games.abbondanzo.com](https://games.abbondanzo.com/)**

| Game | What it tracks |
| --- | --- |
| [Scrabble](docs/scrabble.md) | Words, bonus squares, blanks and bingos, with a dictionary lookup |
| [Cricket (darts)](docs/cricket.md) | Marks, closing out and points - standard, cut-throat or no points |
| [Rummikub](docs/rummikub.md) | Round-by-round scoring from the tiles left on each rack |

Installable as an app on iOS, Android and desktop - see [docs/pwa.md](docs/pwa.md).

## Getting started

```
pnpm install
pnpm dev
```

Then open the `http://localhost:5173` address it prints. It must be **served**, not opened as a
file: browsers give `file://` pages a `null` origin and block their network requests, which
breaks the dictionary.

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server with hot reload |
| `pnpm build` | Type-check and build to `dist/` |
| `pnpm preview` | Serve the production build locally |
| `pnpm test` | Run the test suite once |
| `pnpm test:watch` | Re-run tests on change |
| `pnpm typecheck` | Types only, no build |
| `pnpm icons` | Regenerate the icon set from the trophy artwork |

Needs Node 20+ and pnpm; `corepack enable` picks up the pinned version.

## How it fits together

Each game is a self-contained module under `src/<game>/`, with its rules in plain functions that
have no React in them. Scores are derived by replaying the raw events - words played, darts
thrown, rounds won - rather than being stored, which is what lets cricket switch scoring modes
mid-game without restarting.

Around 260 tests cover the rule engines, the reducers and every tracker end to end.

[CLAUDE.md](CLAUDE.md) has the detail: architecture, conventions, testing approach and the
gotchas worth knowing before changing anything.

## Docs

- [Scrabble](docs/scrabble.md), [Cricket](docs/cricket.md), [Rummikub](docs/rummikub.md) - rules
  and behaviour for each tracker
- [Install and offline use](docs/pwa.md) - PWA setup, icon pipeline, iOS specifics
- [CI and deployment](docs/deployment.md) - what runs where, and what does not

## License

MIT. See [LICENSE](LICENSE).
