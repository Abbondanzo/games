# Rooms

One person hosts a game and gets a four-character code. Anyone who enters it
sees the score update live and can enter their own turns.

## Using it

**To host**, open any game and press **Share**. A code appears in a strip under
the top bar, along with a copyable invite link.

**To join**, either follow the link, or use **Join a game** on the home page and
type the code. Pick which player you are, and you can enter your own scores.

The host runs the room: adding and removing players, changing the rules,
locking it, and removing anyone. Everyone else can enter scores for the player
they picked, and watch everything else.

## What the code is

Four characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` - 923,521 of them. Both
halves of every confusable pair are missing, so there is no 0 or O, and no 1, I
or L. Typing one of those is refused rather than corrected: with both halves
absent there is nothing it could have meant, and guessing could send someone
into a stranger's room.

Codes are freed when a room expires, four hours after its last activity.

## How it works

The room server is a Cloudflare Worker with one Durable Object per room. **The
room is the source of truth**: clients send action requests, the room validates
them, runs the game's own reducer and broadcasts the result. Every client
renders the same snapshot.

Authority sits in the room rather than on the host's phone because iOS suspends
backgrounded tabs and drops sockets within seconds. A host-authoritative room
would pause every time the host put their phone in their pocket, and would need
pause, resume and handoff machinery to be usable at all.

```
guest --action{reqId, rev, action}--> room
                                      check the frame, the rate, the revision,
                                      then whether this actor may do this
                                      state' = reducer(state, action)
room --state{rev, state, cause}--> everyone
```

**Revisions.** Every request carries the revision it was composed against. If
that is not current it is refused and the client resynced, rather than being
re-evaluated against newer state. This matters because "is it your turn?" is a
question about a particular snapshot: `recordTurn` carries no player id, so the
room attributes it to whoever is up.

**Seats.** A seat is a player id. First claim wins, which a Durable Object
serialises naturally. Seats survive a dropped connection, so a sleeping phone
keeps its place, and they are re-derived from the game after every change, so
removing a player cannot leave someone holding a seat that no longer exists.

**Rummikub** is the exception. A round records every rack at once, so it cannot
be seat-scoped. The host opens a round, each player submits their own rack, and
the host commits. That collection lives in room state, not in the game, so
`RummikubState` and its storage never changed.

## Security

The honest threat model: with a few hundred live rooms, finding any room by
guessing costs thousands of attempts, and the prize is scribbling on a score
sheet. The defences are proportionate.

- **Rate limiting on join**, in the stateless Worker in front of the rooms. Code
  shape is checked there too, because `idFromName` will create an object for any
  string - without that check, enumeration would become an object-creation
  attack.
- **Kicking locks the room**, or the person kicked would simply rejoin with a
  fresh identity.
- **Tokens** are random and per member. No client message carries an identity;
  the room stamps it from the socket, so there is nothing to impersonate.
- **Origin allowlist on the socket upgrade.** WebSocket upgrades bypass CORS, so
  the room checks the origin itself.
- **Every frame and every action payload is validated.** The protocol checks the
  frame; the game checks its own action, because only it knows what its actions
  carry.

## Running it locally

```
pnpm worker:dev          # the room server on :8787
VITE_ROOMS_URL=http://localhost:8787 pnpm dev
```

Deploy the Worker by hand with `pnpm worker:deploy`. CI deliberately holds no
secrets and does not deploy.

**Deploy the Worker before the client** when a protocol field is added. The two
deploy independently and the app is precached by a service worker, so a client
can be weeks old. Protocol changes must stay additive; `PROTOCOL_VERSION` is for
breaking ones.

## Testing

Almost all of it runs with no network:

- `permissions.test.ts` - who may do what, exhaustively. The security boundary.
- `roomCore.test.ts` - messages in, effects out.
- `protocol.test.ts` - round trips, and a table of malformed frames.
- `twoClients.test.tsx` - **a host and a guest rendered side by side against a
  real room in-process**, every message encoded and decoded as it would be over
  a socket. The one that would actually catch a regression.

Not covered by tests, so worth a manual pass after changing the Worker:

1. Host on a laptop, join from a phone, check both update within a second.
2. Claim a seat, throw on your turn; try off-turn and read the message.
3. Lock the room and try to join from a third device.
4. Kick the phone and confirm it cannot get back in.
5. Background the host phone for two minutes and confirm it resyncs.
6. Turn off Wi-Fi mid-game and confirm it reconnects.
7. Stop the Worker entirely and confirm solo play on all three games is
   completely unaffected.
