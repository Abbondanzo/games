# Scrabble

Score a game word by word.

## Entering a turn

1. Add players (one at a time, or paste `Ada, Grace, Alan` to add several).
2. Type the word that was played. Each letter appears as a tile showing its point value.
3. Tap a tile to cycle its bonus square: **DL** (double letter) -> **TL** (triple letter) ->
   **blank** (scores 0) -> back to plain. With a tile focused you can also press
   <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> for the letter multiplier and <kbd>B</kbd> for blank.
4. Pick the word multiplier if the play covered one: x2, x3, or x4/x6/x9 when a single play
   hits two premium word squares.
5. Tick **Bingo** if all seven tiles were used (+50).
6. Press <kbd>Enter</kbd> to score the turn. Play advances to the next player automatically.

## Scoring

```
word score = sum of (letter value x letter multiplier) x word multiplier
turn score = sum of word scores + 50 if bingo
```

Blank tiles count as 0 but still sit under any word multiplier, matching the real rules.
A bingo cannot stand as a turn on its own; there has to be a word.

Bonuses stay attached to their letter when the word is edited. Correcting `CAT` to `CHAT`
keeps a double-letter set on the A rather than sliding it onto the newly typed H, because
`tilesFromWord` aligns old and new letters by longest common subsequence rather than by index.

## Other controls

- **+ Another word** banks the current word and clears the box, for a play that forms several
  words at once. They all land on the same turn.
- **Pass** records a scoreless turn; **Undo last** rolls back the most recent entry and hands
  the turn back to whoever played it.
- Click any player on the scoreboard to hand them the turn (handy after a challenge).
- **End-of-game adjustment** applies a plus or minus to one player, for unplayed tile penalties
  and the going-out bonus. It does not consume a turn.
- **New game** clears the scores and keeps the players; **Reset all** clears the players too.
  Both confirm first.
- Removing a player keeps whoever was up actually up, rather than preserving the seat number.

## Dictionary

**Check** rules on the word currently in the entry box. The **Dictionary** button opens a full
lookup with pronunciation and definitions, prefilled with whatever you have typed.

Validity and definitions come from two different places, on purpose.

**Validity is decided offline**, against a word list bundled with the app
(`src/scrabble/lib/words.txt`, 269,870 words). No network call, no waiting, and the same answer
every time. This is what makes the contested words usable: `ax`, `za`, `jo`, `xu` and `qi` are
all in the list, and settled instantly.

It is a general English list rather than TWL or SOWPODS, which belong to Hasbro and Collins and
are not ours to ship. It has no proper nouns and no single letters, so a miss still means
"probably not allowed" rather than a ruling. It is generated from the
[`word-list`](https://www.npmjs.com/package/word-list) package by `pnpm words` and committed,
like the icons; nothing is fetched or processed at build time.

**Definitions come from the [Free Dictionary API](https://dictionaryapi.dev)**, which needs a
connection. They arrive after the verdict and fill in beneath it. If the service is slow, down,
or has never heard of the word, there is simply no definition - the verdict is already on screen
and does not change. A missing sentence is not a ruling and must never be shown as one.

Every check ends in one of three bars:

| Bar   | Meaning                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------- |
| Green | The word is in the list. The definition may follow, or may not.                                     |
| Red   | The word is not in the list. Proper nouns land here, which is right for Scrabble.                   |
| Amber | The list itself could not be read, which should not happen - it is precached. Never a word verdict. |

### The word list

Front-coded: each line is the number of characters it shares with the line before it, as a
letter, then the rest of the word. On a sorted list that turns 2.73 MB into 1.13 MB before
compression, and 377 KB after it. `scripts/generate-words.mjs` writes it, `words.ts` reads it.

It is loaded on its own chunk, on mount rather than on the first Check, so the decode is done by
the time anyone presses the button. The chunk is precached with everything else, so the first
check works with no connection.

The header line is verified rather than skipped. A deploy that has moved the files answers a
request for a missing asset with `index.html`, and HTML that decoded quietly would mean every
word on the board reading as invalid - the worst possible way to fail. A payload that is not the
list, or is short of the word count it declares, is refused.

### Asking the dictionary

The upstream is unreliable in two distinct ways, and neither may reach a verdict any more.

It serves sporadic `5xx` responses unrelated to the word, so only `200` and `404` carry meaning
and everything else retries across both endpoints with a short backoff. Worse, it also accepts
the connection and then never answers: nothing rejects, so a request with no deadline never
finishes at all. Each attempt gets `timeoutMs` and the lookup as a whole gets `budgetMs`, both in
`retryConfig`. Every one of these outcomes now costs the definition and nothing else.

**Cancellation.** A lookup is cancelled by anything that moves on from the word it is about:
typing on, banking another word, passing, scoring the turn, closing the drawer, searching for
something else, or unmounting. `useLookup` owns that - it holds the `AbortController` for the
request in flight and aborts it before starting or clearing anything. Without it a definition for
a word already played landed on the next turn's bar.

**Endpoints.** The API sends `Access-Control-Allow-Origin: *`, so the browser calls it directly.
If that fails the request is retried through a CORS reverse proxy, set as a constant at the top
of `src/scrabble/lib/dictionary.ts`. The proxy shares the same upstream, so it does not help when
the upstream itself is failing - which, since validity no longer depends on it, now costs only
the definition.

**Player-facing copy** never contains status codes or networking terms. `dictionary.test.ts`
enforces that with a jargon guard.
