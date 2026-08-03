# Cricket (darts)

Targets are 20, 19, 18, 17, 16, 15 and the bull. Hit a target three times to close it; after
that it pays points until every opponent has closed it too, at which point it goes dead.

## Throwing

1. Add players.
2. Pick the ring - **Single**, **Double** or **Triple** - then tap where the dart landed.
   A double is two marks, a triple three. **Miss** records a dart that scored nothing.
3. Marks appear on the board as each dart is entered. After the third dart the turn passes on
   by itself; **End turn** closes a short turn early.

The bull has no triple ring, so a bull thrown on **Triple** is recorded as the inner bull: two
marks, 50 points. Outer bull is one mark and 25.

Marks use scoreboard notation, drawn as SVG so they look the same in every font: a stroke for
one, a cross for two, a ringed cross for closed.

## Modes

| Mode | Points go to | Winner |
| --- | --- | --- |
| Standard | The thrower | Closed out with the highest score |
| Cut-throat | Every opponent who has not closed that target | Closed out with the lowest score |
| No points | Nobody, scoring is off | First to close all seven targets |

**No points** turns the game into a pure race to close out. Surplus marks past three do nothing,
the footer row counts total marks instead of points, and the throw preview drops the points
figure.

Switching mode is non-destructive and immediate. Only the darts are stored; points are derived
by replaying them, so changing mode rescores the same throws rather than starting over. Marks,
turn order and history are untouched, and switching back restores the previous totals exactly.

## Winning

Closing all seven targets is not enough on its own - you must also not be losing on points.
Close out while behind and play continues until you catch up, which the tracker enforces.

A win can land on the first or second dart of a turn. That throw is banked so the result
survives a reload.

## Corrections

- Tap a dart chip to remove that dart.
- **Undo turn** clears a throw in progress, or rolls back the last completed turn, handing it
  back to whoever threw it.
- Click a player's column to hand them the turn. Darts already entered are banked with the
  player who actually threw them first, rather than following the seat.
- **New game** clears the board and keeps the players. **Reset all** clears the players too,
  though it keeps the chosen mode. Both confirm first.

Removing a player who has any marks or points asks first and says what they hold. Their throws
are deleted and the game rescored, which can move other players' totals - a target they had
closed may come back to life. Removing a player with nothing on the board is immediate.

## Joining mid-game

Players carry a `joinedAtTurn` stamp. Because every score is derived by replaying all the darts,
without it a late arrival would count as an opponent for throws made before they existed -
reopening dead targets and, in cut-throat, landing them with points they were never dealt. Darts
thrown before someone joined are scored as if they were not at the board.
