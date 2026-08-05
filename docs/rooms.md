# Rooms

One person hosts a game and gets a four-character code. Anyone who enters it
sees the score update live and can enter their own turns.

## Using it

**To host**, open any game and press **Share**, then enter your name. You are a
player like anyone else. A code appears in a strip under the top bar, along with
a copyable invite link.

Sharing starts a fresh game. If anything is already on screen it says what will
be cleared - "2 players and 1 turn" - and the button reads **Clear and start
sharing** rather than hiding it in the small print. With nothing to lose there
is no warning and no extra step.

**To join**, either follow the link, or use **Join a game** on the home page.
Enter the code and the name you want on the scoreboard, and you are in the game
straight away, entering your own scores. Nobody waits on the host.

**Leave** at any time. It gives up your place in the room but leaves your player
and their score on the board, so nothing vanishes from everyone else's view.
Rejoining with the same name takes that player back rather than making a second
one. Your own games on the device are untouched either way.

The host runs the room: typing in anyone playing without a phone, removing
players, changing the rules, stopping new players joining, and removing anyone.
Everyone else enters their own scores and watches the rest.

**Stop new players** closes the door without ending anything, and is what
prevents both a join and the player it would have created. **Close room** ends
it for everyone, and keeps the game on the host's device.

A host cannot simply leave: the game lives in the room, so walking out would
strand it with nobody able to administer it. What they can do is **put somebody
else in charge**, which is a swap rather than a promotion - there is one host at
a time, and whoever gives it away becomes an ordinary player who can then leave.
That is the answer for a host whose battery is going, or who is leaving early.
It moves no part of the game: the snapshot and the revision are untouched.

**Play order** is the host's too, and only until the first turn. Moving somebody
after that would hand the turn to a different player and shuffle a history that
is read as a sequence, so the reducer refuses it and the buttons are not shown.
Before then, whoever is first in the list plays first - following the player
instead would mean moving them to the back still left them going first.

## What the code is

Four characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` - 923,521 of them. Both
halves of every confusable pair are missing, so there is no 0 or O, and no 1, I
or L. Typing one of those is refused rather than corrected: with both halves
absent there is nothing it could have meant, and guessing could send someone
into a stranger's room.

Codes are freed when a room expires, four hours after its last activity.

## When a room ends

A room ends when the host closes it, or four hours after anyone last did
anything. Either way it stops existing, and every device that remembered it has
to be told.

This is harder than it sounds, because **a browser is never told why a socket
failed to open**. A refused upgrade and a train tunnel look identical from the
client, so a room that answers "no room here" with a plain 404 leaves the client
no choice but to keep trying. That was a real bug: a device holding a session
for a long-dead room retried it forever, flickering between getting back to the
room and not being connected.

So the room accepts the socket purely in order to close it with a code:

| Code          | Meaning                              | What the device does  |
| ------------- | ------------------------------------ | --------------------- |
| 4001          | The token is not one this room knows | Forgets the room      |
| 4002          | Closed by the host, or expired       | Forgets the room      |
| 4003          | Removed by the host                  | Forgets the room      |
| anything else | Unexplained                          | Retries, with backoff |

Forgetting means clearing the stored session, so the _next_ visit opens no
socket at all. The host keeps the game that was in the room, since it was theirs
before they shared it; everyone else gets their own saved game back.

Retrying also gives up after about a minute. Not every refusal can be explained

- a room deployed before these codes existed still turns the upgrade away with
  nothing readable on it - so the loop needs an end of its own. Returning to the
  tab, or the network coming back, starts it again.

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

**Seats.** A seat is a player id, handed out when you arrive and never chosen.
The host and every joiner go through the same step: it runs the game's own
`addPlayers` and seats them on the player it creates, so the room and the game
cannot disagree about who is who. An unclaimed player of the same name is taken
back rather than duplicated, which covers rejoining and a host who typed the
roster out in advance. Otherwise a second Grace becomes "Grace 2", since two of
them would be indistinguishable on the scoreboard.

Seats survive a dropped connection, so a sleeping phone keeps its place, and
they are re-derived from the game after every change: if the host removes your
player you become a spectator rather than holding a seat that no longer exists.

**Coming back after leaving.** Leaving gives up the seat but leaves the player
in the game, so the way back is to take that player again. The room recognises
the device, never the name.

A name cannot do this job. It is public - everyone can see it and anyone can
type it. It is not stable - people rename themselves mid-game. And it is not
unique: a table with two Peters has a "Peter" and a "Peter 2", so the name the
second one types on returning is the first one's. That is exactly how the
reported bug produced a "Peter 3".

So each device keeps a secret, one per room code, minted the first time it
joins. It is never shown, never editable, and goes in the body of the join
request over HTTPS and nowhere else - in particular, never over the socket. The
room stores only a SHA-256 digest of it, against the player it holds:

```
join { name, device }  ->  room: devices[sha256(device)] = seatId
```

Coming back is presenting the same secret. The room treats it as a request
rather than a fact: the player has to still exist, be free, and not be one the
host has barred. Everything else is a new player, including a device the room
has not met and one that says nothing at all.

The digest never leaves the room. `roomView` builds what clients see field by
field and none of it is in there, and the message schemas are closed, so a field
added by accident would be stripped by the client's own decode before any code
saw it. There is nothing for a client to read, and so nothing it can do
differently on the strength of.

Names are still made distinct - a second Grace becomes "Grace 2", compared
without regard to case so the board does not carry a "Grace" and a "grace" - but
that is about telling rows apart, not people.

**Claiming a row the host laid out.** Hosts often set the table up before anyone
arrives, typing everybody in, and those rows are there to be taken. Looking the
code up happens as soon as it is complete, so the question comes _before_ the
name field - by the time you have typed a name you have already made a second
player.

A row is on offer exactly while no device has ever answered for it. Once
somebody takes it, it is theirs: it stays theirs while they are away, and
another device asking for it by id gets a new player instead. The host's own row
is never on offer, because their device answered for it when they made the room.

There is nothing to verify in a claim and nothing to verify it with - the host
wrote "Grace" so that Grace could take it, and the room code is what stands
between that and a stranger. That is the same trust the code already carries,
and the host can remove anybody who abuses it.

**Locking stops new players, not people coming back.** A host locks the room
once everyone is at the table, which is exactly when somebody's phone goes to
sleep. A join that takes an existing player is let through - coming back, or
claiming a row - and one that would make a new player is refused.

**Being removed is about a device, and lasts the game.** It used to work by
locking the room, which tangled throwing one person out up with a decision about
everybody else, and unlocking quietly undid it. Now the device is written down
and turned away however the door is set, until the host says otherwise: they are
shown who they have removed and can let them back, by a public handle rather
than by the key the list is really kept on. Their player stays on the board with
its score, and stays spoken for, so nobody can claim it while they are out.

Clearing storage makes a new device, and there is no defence against that beyond
removing them again. The alternative - locking the room on every kick - was
worse, because it punished the whole table for one person.

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
- **Removing somebody is written against their device** and lasts the game,
  whether the room is locked or not. It used to work by locking the room,
  which made throwing one person out a decision about everybody else.
- **Tokens** are random and per member. No client message carries an identity;
  the room stamps it from the socket, so there is nothing to impersonate.
- **Origin allowlist on the socket upgrade.** WebSocket upgrades bypass CORS, so
  the room checks the origin itself. The list allows a single leading `*.`
  wildcard, because every Pages deployment gets its own subdomain and previews
  would otherwise be locked out. It matches exactly one label under one project:
  `*.pages.dev` would admit every site on the platform, and is not allowed.
  Changing the list means redeploying the Worker.
- **Every frame and every action payload is validated.** The protocol checks the
  frame; the game checks its own action, because only it knows what its actions
  carry.

## Running it locally

```
pnpm worker:dev          # the room server on :8787
VITE_ROOMS_URL=http://localhost:8787 pnpm dev
```

**Without `VITE_ROOMS_URL` the app talks to the live room server**, from a dev
server as much as from a pull request preview. There is one room server and no
staging copy of it, so a room made while trying something out is a real room in
real storage. Setting `VITE_ROOMS_URL` as above is what makes a session
isolated, and it is the only way to try a protocol change: a preview client that
has bumped `PROTOCOL_VERSION` is ahead of the deployed room and can only show
the version banner.

Two attempts at a room server per branch, both reverted, both worth not
repeating:

- A non-production deploy command of `wrangler deploy --env preview` does not
  publish a differently named Worker. A Workers Builds project deploys the
  Worker it is connected to, so the name is overridden and the branch goes to
  production instead.
- `wrangler versions upload --preview-alias staging` is accepted and then
  unreachable: Cloudflare does not generate preview URLs for a Worker that
  implements a Durable Object, and this Worker is nothing but one.

A separate Worker does work, and is what was removed - it needs a second Workers
Builds project and so a second build on every push, which is not worth the free
tier for a score sheet.

`curl .../health` says whether the room server is up and which protocol it
speaks. Deploy it by hand with `pnpm worker:deploy`. CI deliberately holds no
secrets and does not deploy.

**Deploy the Worker before the client.** The two deploy independently and the
app is precached by a service worker, so a client can be weeks old.

Only _server-to-client_ additions are safe, because an old client ignores a
frame it cannot read. Adding a _client-to-server_ message is not: an old room
rejects a frame it has never heard of, and the player just sees a button that
does nothing useful. Bump `PROTOCOL_VERSION` whenever one side gains something
the other cannot understand, including that case - the client compares it
against the version in the welcome and says which side is behind, rather than
leaving a generic failure to be puzzled over.

This has already happened once: `closeRoom` shipped to the client while the
deployed Worker predated it, and closing a room reported "Something went wrong"
with nothing to indicate why.

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
7. Close a room, then open that game again on a device that was in it. It should
   say the room has ended, once, and open no socket.
8. Stop the Worker entirely and confirm solo play on all three games is
   completely unaffected.
