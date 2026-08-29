# Yahtzee

The paper score sheet, laid out the way it is printed: thirteen boxes down the side, a column
for each player, and every figure below the line added up as the boxes are filled.

## Filling a box in

Tap the box where the two meet - the player's column, the category's row - and the pad shows
every number that box could hold. Tap one and it is written in. Two taps, and the host can do it
for whoever calls a score out rather than only for whoever is up.

A turn that scored nothing is the same two taps: **Scratch for 0**. It is the commonest entry in
the game and the easiest to leave out, so it sits on the pad beside the numbers rather than
somewhere else.

The pad only offers what the box can hold. An upper box takes a multiple of its own face and
nothing else, so Fives offers 5, 10, 15, 20, 25. A fixed combination offers its one number. A
wrong number cannot be typed, so there is nothing to catch afterwards.

Three of a kind, four of a kind and Chance are the three that add the dice up, and all three ask
for the dice rather than the total.

## Chance

Chance is tapped in a die at a time, five taps, in whatever order they are read off the table.
There is nothing to match in this box, so there is nothing to add up on your behalf either, and
adding a hand in your head before typing it is the step that gets it wrong.

```
the second die 1     2     3     4     5     6
               7     8     9     10    11    12     with a 6 already in
```

Each key carries what the hand comes to with that die in it, so the running total is on screen
throughout and the fifth key names the number it writes. The dice already in sit above the pad
and each one can be taken back where it sits - a misread die does not cost the other four.

**Scratch for 0** is still two taps: a hand worth nothing has no dice worth counting out.

## Three and four of a kind

These two are asked for the way they are said at the table: which number you got four of, and
then what the odd die was. Three of a kind asks the same thing and then what the other two dice
came to. Each key carries the total it makes, so nothing is chosen blind.

```
which number   1     2     3     4     5     6
               5-10  9-14  13-18 17-22 21-26 25-30

four 5s, and the other die
               1     2     3     4     5     6
               21    22    23    24    25    26
```

Asking for the dice rather than the sum is what makes the entry safe. Four fives cannot come to
7, and a pad of totals has no way of saying so: taken on its own, every total from 5 to 30 is
some four of a kind, so nothing can be ruled out until the matched face is known. That is also
why the wire still accepts 5 to 30 for these boxes - the bound is honest only with the face, and
the face is not stored. Chance is the same on the wire for the same reason: five dice can make
any total from 5 to 30, and the dice themselves are not stored either, only what they came to.

The spare dice are free and may land on the matched number too, so five of a kind is offered in
both boxes: it is four of a kind as well, and may be written there.

## What the sheet works out

```
upper total  = the six boxes above the line
bonus        = 35 if that total reaches 63
lower total  = the seven boxes below the line
Yahtzee bonus= 100 for each extra Yahtzee, once the Yahtzee box itself is worth 50
total        = all of it
```

The bonus row counts down what is still needed - "19 to go" - so the decision to chase it is
visible while it can still be made.

**Extra Yahtzees** are the one entry that is not a turn. Rolling a Yahtzee after the box is
already worth 50 scores another 100, and the roll still has to go into some other box, so
claiming one does not move play on. They only pay while the Yahtzee box holds 50: scratch it and
they stop counting, rather than leaving 100s on a sheet that no longer says a Yahtzee was
rolled.

## Turn order

The roster order is the order of play, and play moves on from whoever was just scored rather
than from wherever the pointer happened to be - which is what keeps the table sensible when the
host is entering for whoever speaks up. Tapping a column heading hands the turn over directly.
The order can be rearranged until the first box is filled in, and not after.

A round is counted only once everybody has taken it, so "Round 4 of 13" means everybody has had
three turns.

## Putting a mistake right

- Tapping a box that is already filled offers the same pad, and the new number replaces the old.
  A correction is not a turn, so the order of play does not move on a second time.
- **Empty this box** takes the entry out altogether, for a score written into the wrong row.
- **Undo last** takes back the box most recently filled and hands the turn back to whoever
  filled it.

## Sharing

Every player fills in their own column, on their own turn. The host fills in anybody's, which is
what the people playing without a phone need. A box somebody may never write in is not a button
on their screen at all; a box that is theirs but not yet is there and disabled.

## Removing a player

Their sheet goes with them and nobody else's changes: a Yahtzee sheet is scored on its own,
unlike cricket, where a target somebody had closed changes what everybody else's darts were
worth. The confirmation names how many boxes are about to be deleted.
