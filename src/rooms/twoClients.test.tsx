/**
 * Two devices, one room, one process.
 *
 * A host and a guest are rendered side by side and driven through the real
 * protocol against a real RoomCore. This is the test that would actually catch
 * a rooms regression, and it needs no network at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CricketTracker } from '../cricket/CricketTracker';
import { ScrabbleTracker } from '../scrabble/ScrabbleTracker';
import { createTestRoom, type TestRoom } from './testRoom';
import { PROTOCOL_VERSION } from '@shared/rooms/protocol';
import type { StoredSession } from './storage';
import { boardColumns, countingSockets, mountClient, myColumn, scoreboard } from './testClient';

type User = ReturnType<typeof userEvent.setup>;

const mount = (
  room: TestRoom,
  session: StoredSession,
  label: string,
  options?: { protocol?: number },
): HTMLElement =>
  mountClient(CricketTracker, { room, session, label, protocol: options?.protocol });

const board = (client: HTMLElement) => within(client).getByRole('table');

/** The warning shown before sharing clears a game, not the turn header. */
const warning = () => screen.queryAllByRole('status').find((el) => el.classList.contains('banner'));

const players = boardColumns;

const marksOn = (client: HTMLElement, target: string, column: number) => {
  const row = within(board(client))
    .getAllByRole('row')
    .find((r) => r.querySelector('th')?.textContent?.startsWith(target))!;
  return within(row).getAllByRole('cell')[column]?.textContent ?? '';
};

async function addPlayers(user: User, client: HTMLElement, names: string) {
  await user.type(within(client).getByLabelText('Player name'), names);
  await user.click(within(client).getByRole('button', { name: 'Add' }));
}

async function throwDart(user: User, client: HTMLElement, ring: string, target: string) {
  await user.click(within(client).getByRole('button', { name: ring }));
  await user.click(within(client).getByRole('button', { name: target }));
}

describe('a host and a guest in one room', () => {
  it('shows the host everything the guest does, and the other way round', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    // The host named themselves when starting, and Grace joined; the host adds
    // Ada, who is playing without a phone.
    await waitFor(() => expect(players(host)).toEqual(['Host', 'Grace']));
    await addPlayers(user, host, 'Ada');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace', 'Ada']));
  });

  // Typing your name is the whole of joining. Nobody waits on the host.
  it('puts the joiner straight into the game, seated', async () => {
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));
    // Seated at the door: nothing to choose, nothing to wait for.
    expect(room.state().members[guestSession.memberId]?.seatId).toBeTruthy();
  });

  it('numbers a second joiner with the same name', async () => {
    const room = createTestRoom('cricket');
    room.addMember('Grace');
    const second = room.addMember('Grace');
    const client = mount(room, second, 'second');

    await waitFor(() => expect(players(client)).toEqual(['Host', 'Grace', 'Grace 2']));
  });

  it('lets a guest score on their own turn', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));
    // The host is up first, so they hand the turn to Grace.
    await user.click(within(host).getByTitle("Make it Grace's turn"));
    await waitFor(() => expect(within(guest).getByText('Your throw')).toBeInTheDocument());

    await throwDart(user, guest, 'Triple', 'Triple 20');
    await user.click(within(guest).getByRole('button', { name: 'End turn' }));

    // Both sides agree, because both are rendering the room's own snapshot.
    await waitFor(() => expect(marksOn(host, '20', 1)).toContain('closed'));
    expect(marksOn(guest, '20', 1)).toContain('closed');
  });

  it('refuses a guest a turn that is not theirs, and says whose it is', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    // The host adds Ada and hands her the turn, so it is not the guest's.
    await addPlayers(user, host, 'Ada');
    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace', 'Ada']));
    await user.click(within(host).getByTitle("Make it Ada's turn"));
    await waitFor(() => expect(within(guest).getByText(/Waiting for/)).toHaveTextContent('Ada'));

    // The controls are closed off rather than failing after the fact.
    expect(within(guest).getByRole('button', { name: 'Miss' })).toBeDisabled();
    expect(marksOn(host, '20', 2)).toContain('no marks');
  });

  it('hides the host controls from a guest', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await addPlayers(user, host, 'Ada');
    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace', 'Ada']));

    for (const label of ['New game', 'Reset all']) {
      expect(within(host).getByRole('button', { name: label })).toBeInTheDocument();
      expect(within(guest).queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(within(guest).queryByLabelText('Player name')).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'Cut-throat' })).not.toBeInTheDocument();
  });

  // Locking is what stops a join, and therefore the player it would have made.
  it('turns away a join once the host stops new players', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const host = mount(room, room.hostSession, 'host');

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(host).getByRole('button', { name: 'Stop new players' }));
    await waitFor(() => expect(room.state().locked).toBe(true));

    expect(() => room.addMember('Late')).toThrow(/room-locked/);
  });

  it('drops a kicked member out of the room', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(host).getByRole('button', { name: 'Remove Grace from the room' }));

    await waitFor(() => expect(room.state().members[guestSession.memberId]).toBeUndefined());
    // The one who was removed is told so, rather than left staring at a room
    // that has quietly stopped answering.
    expect(within(guest).getByText(/removed you from that room/)).toBeInTheDocument();

    // Removing one person is not a decision about everybody else, so the door
    // is left as the host set it. Their device is what is kept out.
    expect(room.state().locked).toBe(false);
    // A bare join delivers its broadcast straight into the mounted host, so it
    // has to go through act the way a click on the page would.
    act(() => {
      room.addMember('Grace', 'her-phone');
    });
    expect(players(host)).toContain('Grace 2');
  });

  it('keeps a removed device out for the rest of the game', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guest = room.addMember('Grace', 'her-phone');
    const host = mount(room, room.hostSession, 'host');
    mount(room, guest, 'guest');

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(host).getByRole('button', { name: 'Remove Grace from the room' }));
    await waitFor(() => expect(room.state().members[guest.memberId]).toBeUndefined());

    expect(() => room.addMember('Grace', 'her-phone')).toThrow(/kicked-out/);
  });

  it('shows the host who they removed, and lets them back', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guest = room.addMember('Grace', 'her-phone');
    const host = mount(room, room.hostSession, 'host');
    mount(room, guest, 'guest');

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(host).getByRole('button', { name: 'Remove Grace from the room' }));

    await waitFor(() =>
      expect(within(host).getByText('Removed from this game')).toBeInTheDocument(),
    );
    await user.click(within(host).getByRole('button', { name: 'Let Grace back into the game' }));

    await waitFor(() =>
      expect(within(host).queryByText('Removed from this game')).not.toBeInTheDocument(),
    );
    expect(() => room.addMember('Grace', 'her-phone')).not.toThrow();
  });

  // A host leaving would strand the game on the server, so the only way out
  // ends the room and brings the game back to this device.
  it('lets the host close the room, keeping the game locally', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(host)).toEqual(['Host', 'Grace']));
    await addPlayers(user, host, 'Ada');
    await waitFor(() => expect(players(host)).toEqual(['Host', 'Grace', 'Ada']));

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(host).getByRole('button', { name: 'Close room' }));

    // Back to playing alone, with the roster still there.
    await waitFor(() =>
      expect(within(host).queryByRole('button', { name: 'Who is here' })).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem('games.cricket.v1')).toContain('Grace');
    confirm.mockRestore();
  });

  // Leaving used to only clear the local session: the room never heard about
  // it, and the room's game was then written over this device's own save.
  it('lets a guest leave without disturbing the room or their own game', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    // A game this person was already keeping on their own device.
    localStorage.setItem(
      'games.cricket.v1',
      JSON.stringify({
        players: [{ id: 'x', name: 'Solo', joinedAtTurn: 0 }],
        turns: [],
        currentIndex: 0,
        variant: 'standard',
      }),
    );

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');
    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));

    await user.click(within(guest).getByRole('button', { name: 'Leave' }));

    // Out of the room, with their own game back and untouched.
    await waitFor(() =>
      expect(within(guest).queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument(),
    );
    expect(localStorage.getItem('games.cricket.v1')).toContain('Solo');
    // The room dropped them, so they are no longer taking up a place.
    expect(room.state().members[guestSession.memberId]).toBeUndefined();
    // Their player stays, so a score does not vanish from everyone else's board.
    await waitFor(() => expect(players(host)).toEqual(['Host', 'Grace']));
  });

  it('puts leaving one tap away rather than behind the detail panel', async () => {
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const guest = mount(room, guestSession, 'guest');

    // Without opening "Who is here" first.
    await waitFor(() =>
      expect(within(guest).getByRole('button', { name: 'Leave' })).toBeInTheDocument(),
    );
  });

  it('offers the host no way to leave without closing', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(guest).getByRole('button', { name: 'Who is here' }));

    expect(within(host).queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument();
    expect(within(host).getByRole('button', { name: 'Close room' })).toBeInTheDocument();
    // A guest leaving affects nobody else, so they still can.
    expect(within(guest).getByRole('button', { name: 'Leave the room' })).toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'Close room' })).not.toBeInTheDocument();
  });

  // The exact failure that made "Close room" look broken: a room deployed
  // before the frame existed rejects it, with nothing to explain why.
  it('says so when the room is behind this app', async () => {
    const room = createTestRoom('cricket');
    const host = mount(room, room.hostSession, 'host', { protocol: PROTOCOL_VERSION - 1 });

    await waitFor(() => expect(within(host).getByText(/needs updating/i)).toBeInTheDocument());
  });

  it('says nothing when both sides match', async () => {
    const room = createTestRoom('cricket');
    const host = mount(room, room.hostSession, 'host');

    await waitFor(() => expect(within(host).getByText('AB2D')).toBeInTheDocument());
    expect(within(host).queryByText(/needs updating/i)).not.toBeInTheDocument();
  });

  it('keeps the room code on screen for both of them', async () => {
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(within(host).getByText('AB2D')).toBeInTheDocument());
    expect(within(guest).getByText('AB2D')).toBeInTheDocument();
  });
});

/**
 * The session is generic, so a second game is the test that it is not
 * accidentally shaped around cricket.
 */
describe('controls a cricket guest may not use', () => {
  it('does not offer the turn pointer, which is the host to move', async () => {
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));
    expect(within(host).getByTitle("Make it Grace's turn")).toBeInTheDocument();
    // It used to be a button wired to nothing, which is worse than no button.
    expect(within(guest).queryByTitle("Make it Grace's turn")).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: /Make it/ })).not.toBeInTheDocument();
  });

  it('still shows a guest every column of the board', async () => {
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));
  });

  it('marks which column on the board is you', async () => {
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));
    expect(myColumn(guest)).toHaveTextContent('Grace');
  });

  // Undo is not host-only in cricket: it is yours while the last turn is yours.
  it('offers undo to whoever threw last, and nobody else', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));
    await user.click(within(host).getByTitle("Make it Grace's turn"));
    await waitFor(() => expect(within(guest).getByText('Your throw')).toBeInTheDocument());

    await throwDart(user, guest, 'Triple', 'Triple 20');
    await user.click(within(guest).getByRole('button', { name: 'End turn' }));

    await waitFor(() => expect(within(guest).getByRole('button', { name: /Undo/ })).toBeEnabled());

    // The host throws, so the last turn on the board is no longer the guest's.
    await throwDart(user, host, 'Triple', 'Triple 19');
    await user.click(within(host).getByRole('button', { name: 'End turn' }));

    await waitFor(() => expect(within(guest).getByRole('button', { name: /Undo/ })).toBeDisabled());
  });

  it('still lets a guest clear the darts in their own hand', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));
    await user.click(within(host).getByTitle("Make it Grace's turn"));
    await waitFor(() => expect(within(guest).getByText('Your throw')).toBeInTheDocument());

    await throwDart(user, guest, 'Triple', 'Triple 20');
    // Nothing has been sent to the room yet, so taking it back is nobody's business.
    expect(within(guest).getByRole('button', { name: /Undo/ })).toBeEnabled();
  });
});

/**
 * Coming back after leaving.
 *
 * Reported from a real table: the host was Peter, Peter joined again from a
 * second device and became "Peter 2", left, came back typing "Peter" - and
 * became "Peter 3". A name cannot identify somebody returning, because the name
 * they type is the one somebody else already has, and because names are theirs
 * to change. The room recognises a secret the device keeps instead.
 */
describe('coming back after leaving', () => {
  const seatOf = (room: TestRoom, memberId: string) => room.state().members[memberId]?.seatId;

  it('takes back the same player, even sharing a name with the host', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket', 'Peter');
    const second = room.addMember('Peter', 'this-phone');

    const guest = mount(room, second, 'guest');
    await waitFor(() => expect(players(guest)).toEqual(['Peter', 'Peter 2']));
    const seat = seatOf(room, second.memberId);

    await user.click(within(guest).getByRole('button', { name: 'Leave' }));

    // Typing "Peter" again, which is the host's name, not theirs.
    const back = room.addMember('Peter', 'this-phone');
    expect(seatOf(room, back.memberId)).toBe(seat);

    const returned = mount(room, back, 'returned');
    await waitFor(() => expect(players(returned)).toEqual(['Peter', 'Peter 2']));
  });

  it('keeps the score that player had', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket', 'Peter');
    const second = room.addMember('Peter', 'this-phone');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, second, 'guest');
    await waitFor(() => expect(players(guest)).toEqual(['Peter', 'Peter 2']));

    await user.click(within(host).getByTitle("Make it Peter 2's turn"));
    await throwDart(user, guest, 'Triple', 'Triple 20');
    await user.click(within(guest).getByRole('button', { name: 'End turn' }));
    await waitFor(() => expect(marksOn(host, '20', 1)).toContain('closed'));

    await user.click(within(guest).getByRole('button', { name: 'Leave' }));
    const returned = mount(room, room.addMember('Peter', 'this-phone'), 'returned');

    await waitFor(() => expect(players(returned)).toEqual(['Peter', 'Peter 2']));
    // Their marks are still theirs, which is the point of coming back.
    expect(marksOn(returned, '20', 1)).toContain('closed');
  });

  it('makes a new player for a device that was never here', async () => {
    const room = createTestRoom('cricket', 'Peter');
    const client = mount(room, room.addMember('Peter', 'another-phone'), 'other');
    await waitFor(() => expect(players(client)).toEqual(['Peter', 'Peter 2']));
  });

  // Locking is for new players, and somebody coming back is not one.
  it('gets back into a room the host has closed to new players', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket', 'Peter');
    const second = room.addMember('Peter', 'this-phone');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, second, 'guest');
    await waitFor(() => expect(players(guest)).toEqual(['Peter', 'Peter 2']));

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(host).getByRole('button', { name: 'Stop new players' }));
    await waitFor(() => expect(room.state().locked).toBe(true));
    await user.click(within(guest).getByRole('button', { name: 'Leave' }));

    expect(() => room.addMember('Peter', 'this-phone')).not.toThrow();
    // A device it has never met is still a stranger.
    expect(() => room.addMember('Alan', 'a-third-phone')).toThrow(/room-locked/);
  });
});

describe('a Scrabble room', () => {
  const mountScrabble = (room: TestRoom, session: StoredSession, label: string) =>
    mountClient(ScrabbleTracker, { room, session, label });

  const scores = scoreboard;

  it('shows the host a word the guest scored', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('scrabble');
    const guestSession = room.addMember('Grace');

    const host = mountScrabble(room, room.hostSession, 'host');
    const guest = mountScrabble(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toEqual(['Host:0', 'Grace:0']));
    // The host is up first, so they hand the turn to Grace.
    await user.click(within(host).getByTitle("Make it Grace's turn"));

    await user.type(within(guest).getByLabelText('Word played'), 'quiz');
    await user.click(within(guest).getByRole('button', { name: 'Score turn' }));

    await waitFor(() => expect(scores(host)).toEqual(['Grace:22', 'Host:0']));
    expect(scores(guest)).toEqual(['Grace:22', 'Host:0']);
  });

  it('keeps the host controls to the host', async () => {
    const room = createTestRoom('scrabble');
    const guestSession = room.addMember('Grace');

    const host = mountScrabble(room, room.hostSession, 'host');
    const guest = mountScrabble(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toEqual(['Host:0', 'Grace:0']));

    for (const label of ['New game', 'Reset all']) {
      expect(within(host).getByRole('button', { name: label })).toBeInTheDocument();
      expect(within(guest).queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    // The dictionary is nobody's privilege.
    expect(within(guest).getByRole('button', { name: 'Dictionary' })).toBeEnabled();
  });

  // Closed off rather than refused after the fact, as cricket is. The
  // reject-and-restore path still exists for the race where the turn moves
  // between rendering and tapping.
  it('closes off the entry when it is not your turn', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('scrabble');
    const guestSession = room.addMember('Grace');

    const host = mountScrabble(room, room.hostSession, 'host');
    const guest = mountScrabble(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toEqual(['Host:0', 'Grace:0']));

    // The host adds Ada and hands her the turn, so Grace's play is refused.
    await user.type(within(host).getByLabelText('Player name'), 'Ada');
    await user.click(within(host).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(scores(guest)).toHaveLength(3));
    await user.click(within(host).getByTitle("Make it Ada's turn"));

    await waitFor(() =>
      expect(within(guest).getByRole('button', { name: 'Score turn' })).toBeDisabled(),
    );
    expect(within(guest).getByRole('button', { name: 'Pass' })).toBeDisabled();

    // The host, whose turn it is not either, is never gated: they run the room.
    expect(within(host).getByRole('button', { name: 'Score turn' })).toBeEnabled();
  });
});

/** Sharing starts a fresh game, so it must say what it is about to clear. */
describe('starting to share', () => {
  it('warns, and names what is on screen, before clearing it', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'games.cricket.v1',
      JSON.stringify({
        players: [
          { id: 'a', name: 'Ada', joinedAtTurn: 0 },
          { id: 'b', name: 'Bo', joinedAtTurn: 0 },
        ],
        turns: [{ id: 't', playerId: 'a', darts: [{ target: 20, multiplier: 3 }] }],
        currentIndex: 0,
        variant: 'standard',
      }),
    );

    mountClient(CricketTracker);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(warning()).toHaveTextContent('2 players and 1 turn');
    // The button says what it does, rather than hiding it in the small print.
    expect(screen.getByRole('button', { name: /Clear and start sharing/ })).toBeInTheDocument();
  });

  it('says nothing when there is nothing to lose', async () => {
    const user = userEvent.setup();
    mountClient(CricketTracker);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(screen.queryByText(/will be cleared/)).not.toBeInTheDocument();
    // No warning styling either, so an empty game is a plain first step.
    expect(warning()).toBeUndefined();
    expect(screen.getByRole('button', { name: /^Start sharing$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear and/ })).not.toBeInTheDocument();
  });

  // A roster somebody typed out is worth warning about even before anyone has
  // thrown, because retyping it is the annoying part.
  it('warns about players alone, with no turns yet', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'games.cricket.v1',
      JSON.stringify({
        players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }],
        turns: [],
        currentIndex: 0,
        variant: 'standard',
      }),
    );

    mountClient(CricketTracker);
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(warning()).toHaveTextContent('1 player');
    expect(warning()).not.toHaveTextContent('turn');
  });

  it('does nothing until the button is pressed', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.setItem(
      'games.cricket.v1',
      JSON.stringify({
        players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }],
        turns: [],
        currentIndex: 0,
        variant: 'standard',
      }),
    );

    mountClient(CricketTracker);
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('games.cricket.v1')).toContain('Ada');
    vi.unstubAllGlobals();
  });
});

describe('playing alone', () => {
  // The whole point of the refactor: solo play must be untouched, and must not
  // reach for the network even once.
  it('never constructs a socket and still saves to storage', async () => {
    const user = userEvent.setup();
    const sockets = countingSockets();

    mountClient(CricketTracker);
    await user.type(screen.getByLabelText('Player name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(sockets.count()).toBe(0);
    expect(localStorage.getItem('games.cricket.v1')).toContain('Ada');
    expect(screen.queryByText('Who is here')).not.toBeInTheDocument();

    sockets.restore();
  });

  it('scores Scrabble exactly as it always did', async () => {
    const user = userEvent.setup();
    const sockets = countingSockets();

    mountClient(ScrabbleTracker);
    await user.type(screen.getByLabelText('Player name'), 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await user.type(screen.getByLabelText('Word played'), 'quiz');
    await user.click(screen.getByRole('button', { name: 'Score turn' }));

    expect(scoreboard()).toEqual(['Ada:22', 'Grace:0']);
    expect(sockets.count()).toBe(0);
    expect(localStorage.getItem('games.scrabble.v1')).toContain('Ada');

    sockets.restore();
  });
});
