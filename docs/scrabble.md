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

**Check** validates the word currently in the entry box. The **Dictionary** button opens a full
lookup with pronunciation and definitions, prefilled with whatever you have typed.

Definitions come from the [Free Dictionary API](https://dictionaryapi.dev), so an internet
connection is needed. It is a general English dictionary rather than the official Scrabble word
list (TWL/SOWPODS), so a miss means "probably not a word", not a ruling.

Every lookup ends in one of three verdict bars:

| Bar   | Meaning                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------- |
| Green | The dictionary has the word.                                                                             |
| Red   | The dictionary answered and does not have the word. Proper nouns land here, which is right for Scrabble. |
| Amber | No answer at all. This says nothing about the word - retry.                                              |

Keeping amber distinct from red matters. The upstream serves sporadic `5xx` responses that have
nothing to do with the word: `ax`, `za`, `jo` and `xu` are all valid and have each been observed
failing once then resolving on a retry. Only `200` and `404` carry meaning, so a lookup retries
up to 3 rounds across both endpoints with a short backoff, and failures are never cached.

Two-letter words are hit hardest, and they are exactly the contested ones in Scrabble. `ax` was
measured succeeding roughly 1 attempt in 5; retrying raises that to around 3 in 4, but it is not
a guarantee.

**Endpoints.** The API sends `Access-Control-Allow-Origin: *`, so the browser calls it directly.
If that fails the request is retried through a CORS reverse proxy, set as a constant at the top
of `src/scrabble/lib/dictionary.ts`. The proxy shares the same upstream, so it does not help
when the upstream itself is failing.

**Player-facing copy** never contains status codes or networking terms. `dictionary.test.ts`
enforces that with a jargon guard.

### Known gap

Because validity depends on a flaky third-party service, some valid short words are occasionally
unverifiable. Bundling an offline Scrabble word list (TWL/SOWPODS, roughly 1.9 MB) would make
validity instant, authoritative and offline, leaving the API to supply definitions only. Not
implemented.
