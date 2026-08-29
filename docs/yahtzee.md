# Yahtzee

The paper score sheet, laid out the way it is printed: thirteen boxes down the side, a column
for each player, and every figure below the line added up as the boxes are filled.

## Filling a box in

Tap the box where the two meet - the player's column, the category's row - and the pad asks what
you rolled. Tap the answer and the score is written in. Two taps for most boxes, and the host
can do it for whoever calls a score out rather than only for whoever is up.

A turn that scored nothing is the same two taps: **Scratch for 0**. It is the commonest entry in
the game and the easiest to leave out, so it sits on the pad beside the numbers rather than
somewhere else.

**No box asks for a total**, because the total is the one thing nobody at the table says out
loud. You say "three fives", or "four of a kind on 5, and a 3". The upper boxes ask how many;
the three boxes that add the dice up ask for the dice; only a fixed combination is a single
number, and it is the same number every time. A key carries the one number it is an answer with

- how many, or which die - and never what that comes to as well: the second figure is one more
  to read past on the way to the first.

## The upper section

Fives asks how many fives you got, not what they came to.

```
how many fives 1     2     3     4     5
```

Two taps still, and the pad can only produce a multiple of the face, so there is nothing to
catch afterwards.

## Chance

Chance is tapped in a die at a time, five taps, in whatever order they are read off the table.
There is nothing to match in this box, so there is no shorter way to say what was rolled, and
adding a hand up in your head before typing it is the step that gets it wrong.

```
6  _  _  _  _                                       one die in, four to go
the second die 1     2     3     4     5     6
```

The dice already in sit above the pad, with a place for each one still to come, and any of them
can be taken back where it sits - a misread die does not cost the other four. Where the hand
stands is said once, above the keys - "Three more dice. 10 so far." - rather than on all six of
them.

**Scratch for 0** is still two taps: a hand worth nothing has no dice worth counting out.

## Three and four of a kind

These two are asked for the way they are said at the table: which number you got four of, and
then what the odd die was. Three of a kind asks the same thing and then its two spare dice, one
at a time, the same way Chance takes all five. The first question is the one choice that is not
plain from the dice in front of you, so it is the one place a key says what it could come to.

```
which number   1     2     3     4     5     6
               5-10  9-14  13-18 17-22 21-26 25-30

5  5  5  5  _                        four 5s, and the other die
               1     2     3     4     5     6
```

Asking for the dice rather than the sum is what makes the entry safe. Four fives cannot come to
7, and a pad of totals has no way of saying so: taken on its own, every total from 5 to 30 is
some four of a kind, so nothing can be ruled out until the matched face is known. That is also
why the wire still accepts 5 to 30 for these boxes - the bound is honest only with the face, and
the face is not stored. Chance is the same on the wire for the same reason: five dice can make
any total from 5 to 30, and the dice themselves are not stored either, only what they came to.

The spare dice are free and may land on the matched number too, so five of a kind is offered in
both boxes: it is four of a kind as well, and may be written there.

The matched dice sit above the pad, with a place for each die still to come, so the whole hand
is on screen while it is entered. The dice tapped in can be taken back where they sit; the
matched ones are changed with **Change the number**, which asks the first question again.

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
