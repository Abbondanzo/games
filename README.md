# Board Games

Browser-based score trackers for board games. React + TypeScript, built with Vite.

```
pnpm install
pnpm dev
```

Then open the printed `http://localhost:5173` address (it opens automatically).

> The app must be **served**, not opened as a file. Browsers give `file://` pages a `null`
> origin and block their network requests, which is what made the dictionary fail with
> "Failed to fetch".

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server with hot reload |
| `pnpm build` | Type-check and build to `dist/` |
| `pnpm preview` | Serve the production build locally |
| `pnpm test` | Run the test suite once |
| `pnpm test:watch` | Re-run tests on change |
| `pnpm typecheck` | Types only, no build |

Requires Node 20+ and pnpm (`corepack enable` picks up the version pinned in
`package.json`). `pnpm-workspace.yaml` allows esbuild's postinstall, which fetches its
platform binary; without it pnpm blocks the script and the build cannot run.

## Scrabble tracker

Score a game word by word.

**Entering a turn**

1. Add players (one at a time, or paste `Ada, Grace, Alan` to add several).
2. Type the word that was played. Each letter appears as a tile showing its point value.
3. Tap a tile to cycle its bonus square: **DL** (double letter) → **TL** (triple letter) →
   **blank** (scores 0) → back to plain. With a tile focused you can also press
   <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> for the letter multiplier and <kbd>B</kbd> for blank.
4. Pick the word multiplier if the play covered one: ×2, ×3, or ×4/×6/×9 when a single play
   hits two premium word squares.
5. Tick **Bingo** if all seven tiles were used (+50).
6. Press <kbd>Enter</kbd> to score the turn. Play advances to the next player automatically.

**Other bits**

- **+ Another word** banks the current word and clears the box, for a play that forms several
  words at once. They all land on the same turn.
- **Pass** records a scoreless turn; **Undo last** rolls back the most recent entry.
- Click any player on the scoreboard to hand them the turn (handy after a challenge).
- **End-of-game adjustment** applies a plus or minus to one player - unplayed tile penalties
  and the going-out bonus. It does not consume a turn.
- Games are saved to `localStorage`, so a reload doesn't lose one. **New game** clears the
  scores and keeps the players; **Reset all** clears the players too. Both confirm first.

**Scoring**

```
word score = Σ (letter value × letter multiplier) × word multiplier
turn score = Σ word scores + 50 if bingo
```

Blank tiles count as 0 but still sit under any word multiplier, matching the real rules.

## Cricket (darts)

Targets are 20, 19, 18, 17, 16, 15 and the bull. Hit a target three times to close it; after
that it pays points until every opponent has closed it too, at which point it goes dead.

**Throwing**

1. Add players.
2. Pick the ring - **Single**, **Double** or **Triple** - then tap where the dart landed.
   A double is two marks, a triple three. **Miss** records a dart that scored nothing.
3. Marks appear on the board as each dart is entered. After the third dart the turn passes on
   by itself; **End turn** closes a short turn early.

The bull has no triple ring, so a bull thrown on **Triple** is recorded as the inner bull -
two marks, 50 points. Outer bull is one mark and 25.

Marks use scoreboard notation, drawn as SVG so they look the same in every font: a stroke for
one, a cross for two, a ringed cross for closed.

**Modes**

| Mode | Points go to | Winner |
| --- | --- | --- |
| Standard | The thrower | Closed out with the highest score |
| Cut-throat | Every opponent who has not closed that target | Closed out with the lowest score |
| No points | Nobody, scoring is off | First to close all seven targets |

**No points** turns the game into a pure race to close out. Surplus marks past three do nothing,
the footer row counts total marks instead of points, and the throw preview drops the points
figure. It is the quickest mode and the one to use when nobody wants to track a score.

Switching mode is non-destructive and takes effect immediately. Only the darts are stored;
points are derived by replaying them, so changing mode rescores the same throws rather than
starting over. Marks, turn order and history are untouched, and switching back restores the
previous totals exactly.

**Winning.** Closing all seven targets is not enough on its own - you must also not be losing on
points. Close out while behind and the game continues until you catch up, which the tracker
enforces. Note that a win can land on the first or second dart of a turn; that throw is banked
so the result survives a reload.

**Corrections.** Tap a dart chip to remove that dart. **Undo turn** clears a throw in progress,
or rolls back the last completed turn. Click a player's column to hand them the turn.

**New game** clears the board and keeps the players. **Reset all** clears the players as well,
though it keeps the chosen mode so the next game starts the same way. Both confirm first.

Removing a player who has any marks or points asks first, and says what they hold. Their throws
are deleted and the game is rescored, which can move other players' totals - a target they had
closed may come back to life. Removing a player with nothing on the board is immediate.

## Rummikub

Round-by-round scoring. Rummikub is scored on what is *left* rather than what is played, so a
round is entered after someone goes out.

**Scoring a round**

1. Add players, then pick who went out.
2. For everyone else, enter the tiles still on their rack. Tap a player, then tap the tile
   values they were holding, or just type the total if you have already added it up. A **Joker**
   left on the rack costs 30.
3. The winner's score appears live as the racks are entered.

```
each loser  = -(their remaining tiles)
the winner  = + the sum of every other rack
```

Totals therefore net to zero within a round, which makes the running scoreboard
self-checking - if the column does not sum to zero, a rack was entered wrong.

**Other bits**

- Cumulative totals across rounds, ranked, with rounds won as the tie-break.
- **Undo last** rolls back a round; history shows the per-player swing for each one.
- Removing a player rescores every round. Rounds they merely lost are kept and recalculated
  without their rack; rounds they *won* are deleted, since a round is defined by who went out.
  You are warned before either happens.

## Dictionary

**Check** validates the word currently in the entry box. The **Dictionary** button opens a
full lookup with pronunciation and definitions, prefilled with whatever you've typed.

Definitions come from the [Free Dictionary API](https://dictionaryapi.dev), so an internet
connection is needed. It's a general English dictionary rather than the official Scrabble word
list (TWL/SOWPODS), so a miss means "probably not a word", not a ruling - short Scrabble-legal
oddities like `QI` and `ZA` may not be listed.

Every lookup ends in one of three verdict bars:

| Bar | Meaning |
| --- | --- |
| 🟩 green | The dictionary has the word. |
| 🟥 red | The dictionary answered and does not have the word. Proper nouns land here, which is right for Scrabble. |
| 🟨 amber | We never got an answer. This says nothing about the word - retry. |

Keeping the amber case distinct from red matters: the upstream serves sporadic `502`s that have
nothing to do with the word. `ax`, `za`, `jo` and `xu` - all valid - have each been observed
failing once and then resolving on a retry, so a `5xx` must never be shown as "not a word".
Only `200` and `404` carry meaning. A lookup therefore retries up to 3 rounds across both
endpoints with a short backoff, and failures are never cached.

Two-letter words are hit hardest by this, and they are exactly the contested ones in Scrabble.
`ax` was measured succeeding roughly 1 attempt in 5. Retrying raises that to around 3 in 4, but
it is not a guarantee - see "Known gap" below.

**Endpoints.** The API sends `Access-Control-Allow-Origin: *`, so the browser calls it directly.
If that call fails, the request is retried once through a CORS reverse proxy, set as a constant
at the top of `src/scrabble/lib/dictionary.ts`. Note the proxy shares the same upstream, so it
does not help when the upstream itself is failing.

**Player-facing copy** never contains status codes or networking terms; `dictionary.test.ts`
enforces that with a jargon guard.

### Known gap

Because validity depends on a flaky third-party service, some valid short words are
occasionally unverifiable. Bundling an offline Scrabble word list (TWL/SOWPODS, roughly 1.9 MB)
would make validity instant, authoritative and offline, leaving the API to supply definitions
only. That is not implemented.

## Layout

```
src/
  App.tsx                       routes
  index.css                     all styling
  shared/Home.tsx               game list
  shared/PlayersCard.tsx        add/remove players, shared by every game
  scrabble/
    ScrabbleTracker.tsx         page, owns the draft turn
    components/                 PlayersCard, TurnEntry, TileRow, HistoryCard, DictionaryDrawer
    lib/
      scoring.ts                pure scoring - no React
      useGame.ts                reducer + localStorage persistence
      dictionary.ts             lookup, caching, proxy fallback
      types.ts
  rummikub/
    RummikubTracker.tsx         page
    components/RoundEntry.tsx   winner picker, racks and tile pad
    lib/
      rummikub.ts               pure scoring - round maths and standings
      useRummikub.ts            reducer + localStorage persistence
      types.ts
  cricket/
    CricketTracker.tsx          page, owns the throw in progress
    components/                 CricketBoard, DartEntry, MarkGlyph
    lib/
      cricket.ts                pure rules - marks, closing, scoring, winning
      useCricket.ts             reducer + localStorage persistence
      types.ts
```

## Deployment

Pushes and pull requests to `main` run `.github/workflows/deploy.yml`: install, type check,
test, build, then upload `dist/` as an artifact. A push to `main` deploys that artifact to
Cloudflare Pages; a pull request deploys a preview and comments the URL on the PR, updating the
same comment rather than adding a new one each run.

The deploy jobs reuse the artifact from the CI job, so the thing that ships is the exact output
that was tested, and they skip the pnpm install entirely since `wrangler-action` brings its own
wrangler.

**Setup required before the first deploy**

1. Create a Cloudflare Pages project named `games` (direct upload, not a Git integration -
   the workflow pushes the build itself). To use a different name, change
   `CLOUDFLARE_PROJECT_NAME` at the top of the workflow.
2. Add two repository secrets under Settings > Secrets and variables > Actions:
   - `CLOUDFLARE_API_TOKEN` - an API token with the **Cloudflare Pages: Edit** permission
   - `CLOUDFLARE_ACCOUNT_ID` - from the Cloudflare dashboard URL or the account home page
3. The `deploy` job targets a `production` environment. Either create it under
   Settings > Environments or drop the `environment: production` line.

No SPA fallback or `_redirects` file is needed: routing is hash-based, so every URL is served
by `index.html` already.

## House style

Plain hyphens only, no em or en dashes, and no emoji. Both are enforced by tests in
`App.test.tsx` that scan the source and fail the build.

## Icons

Icons come from [lucide-react](https://lucide.dev), tree-shaken so only the ones used are
bundled (about 2 kB gzipped). The cricket marks are purpose-drawn SVG, since no icon set has
scoreboard notation. There are no emoji anywhere - they render differently on every platform -
and a test in `App.test.tsx` fails the build if one is added.

## Layout notes

Each game keeps its rules in plain functions with no React in them, so they are testable on
their own - cricket's scoring in particular depends on the order darts landed, and `cricket.ts`
replays them. `pnpm test` covers all three rule engines, all three reducers, the dictionary
fallback chain, and every tracker end to end under jsdom.

## License

MIT. See [LICENSE](LICENSE).
