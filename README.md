# Games

Score trackers for the games I actually play. React + TypeScript. Playing alone needs nothing
but the browser: it saves to `localStorage` and works offline. Sharing a game with other people
uses a small room server.

**[games.abbondanzo.com](https://games.abbondanzo.com/)**

| Game | What it tracks |
| --- | --- |
| [Scrabble](docs/scrabble.md) | Words, bonus squares, blanks and bingos, with a dictionary lookup |
| [Cricket (darts)](docs/cricket.md) | Marks, closing out and points - standard, cut-throat or no points |
| [Rummikub](docs/rummikub.md) | Round-by-round scoring from the tiles left on each rack |

Any game can be [shared with a four-character code](docs/rooms.md), so everyone at the table
sees the score and enters their own turns.

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
| `pnpm worker:dev` | Run the room server locally on :8787 |
| `pnpm worker:deploy` | Deploy the room server |

Needs Node 20+ and pnpm; `corepack enable` picks up the pinned version.

## How it fits together

Pure domain code - game rules, reducers and the room protocol - lives in `shared/`, with no
React and no browser APIs, so the room server can run exactly the same code the app does. `src/`
is the React app and `worker/` is the room server.

Scores are derived by replaying the raw events - words played, darts thrown, rounds won - rather
than being stored, which is what lets cricket switch scoring modes mid-game without restarting.

Around 480 tests cover the rule engines, the reducers, the room protocol and every tracker end
to end.

[CLAUDE.md](CLAUDE.md) has the detail: architecture, conventions, testing approach and the
gotchas worth knowing before changing anything.

## Docs

- [Scrabble](docs/scrabble.md), [Cricket](docs/cricket.md), [Rummikub](docs/rummikub.md) - rules
  and behaviour for each tracker
- [Rooms](docs/rooms.md) - sharing a game, and how the room server works
- [Install and offline use](docs/pwa.md) - PWA setup, icon pipeline, iOS specifics
- [CI and deployment](docs/deployment.md) - what runs where, and what does not

## License

MIT. See [LICENSE](LICENSE).
