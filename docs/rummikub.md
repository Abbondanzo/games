# Rummikub

Round-by-round scoring. Rummikub is scored on what is *left* rather than what is played, so a
round is entered after someone goes out.

## Scoring a round

1. Add players, then pick who went out.
2. For everyone else, enter the tiles still on their rack. Tap a player, then tap the tile values
   they were holding, or type the total if you have already added it up. A **Joker** left on the
   rack costs 30.
3. The winner's score appears live as the racks are entered.

```
each loser  = -(their remaining tiles)
the winner  = + the sum of every other rack
```

Totals net to zero within a round, which makes the running scoreboard self-checking: if the
column does not sum to zero, a rack was entered wrong. There is a test for that invariant.

## Other controls

- Cumulative totals across rounds, ranked, with rounds won as the tie-break.
- **Undo last** rolls back a round; history shows the per-player swing for each one.
- A penalty recorded against the winner is discarded - they went out, so by definition they
  hold nothing.

## Removing a player

Rounds they merely lost are kept and recalculated without their rack, so the winner's pot
shrinks accordingly. Rounds they *won* are deleted, since a round is defined by who went out and
cannot survive without them. The confirmation names how many rounds will go.
