/**
 * Two devices, one room, one process.
 *
 * A host and a guest are rendered side by side and driven through the real
 * protocol against a real RoomCore. This is the test that would actually catch
 * a rooms regression, and it needs no network at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CricketTracker } from '../cricket/CricketTracker';
import { ScrabbleTracker } from '../scrabble/ScrabbleTracker';
import { RoomProvider } from './RoomProvider';
import { createTestRoom, type TestRoom } from './testRoom';
import { PROTOCOL_VERSION } from '@shared/rooms/protocol';
import type { StoredSession } from './storage';

type User = ReturnType<typeof userEvent.setup>;

/** Renders one client into its own container, so the two never collide. */
function mount(
  room: TestRoom,
  session: StoredSession,
  label: string,
  options?: { protocol?: number },
): HTMLElement {
  const host = document.createElement('div');
  host.dataset.client = label;
  document.body.append(host);
  render(
    <RoomProvider value={{ transport: room.transport(options), session }}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CricketTracker />
      </MemoryRouter>
    </RoomProvider>,
    { container: host },
  );
  return host;
}

const board = (client: HTMLElement) => within(client).getByRole('table');

const marksOn = (client: HTMLElement, target: string, column: number) => {
  const row = within(board(client)).getAllByRole('row')
    .find((r) => r.querySelector('th')?.textContent?.startsWith(target))!;
  return within(row).getAllByRole('cell')[column]?.textContent ?? '';
};

const players = (client: HTMLElement) =>
  within(board(client)).getAllByRole('columnheader').slice(1).map((h) => h.textContent);

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
    await waitFor(() => expect(within(guest).getByText(/Now throwing/)).toHaveTextContent('Grace'));

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
    await waitFor(() => expect(within(guest).getByText(/Now throwing/)).toHaveTextContent('Ada'));

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
    mount(room, guestSession, 'guest');

    await user.click(within(host).getByRole('button', { name: 'Who is here' }));
    await user.click(within(host).getByRole('button', { name: 'Remove Grace from the room' }));

    await waitFor(() => expect(room.state().members[guestSession.memberId]).toBeUndefined());
    // Kicking closes the room, or they would simply rejoin.
    expect(room.state().locked).toBe(true);
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
      expect(within(host).queryByRole('button', { name: 'Who is here' })).not.toBeInTheDocument());
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
      JSON.stringify({ players: [{ id: 'x', name: 'Solo', joinedAtTurn: 0 }], turns: [], currentIndex: 0, variant: 'standard' }),
    );

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');
    await waitFor(() => expect(players(guest)).toEqual(['Host', 'Grace']));

    await user.click(within(guest).getByRole('button', { name: 'Leave' }));

    // Out of the room, with their own game back and untouched.
    await waitFor(() =>
      expect(within(guest).queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument());
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
      expect(within(guest).getByRole('button', { name: 'Leave' })).toBeInTheDocument());
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

    await waitFor(() =>
      expect(within(host).getByText(/needs updating/i)).toBeInTheDocument());
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
describe('a Scrabble room', () => {
  function mountScrabble(room: TestRoom, session: StoredSession, label: string): HTMLElement {
    const container = document.createElement('div');
    container.dataset.client = label;
    document.body.append(container);
    render(
      <RoomProvider value={{ transport: room.transport(), session }}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrabbleTracker />
        </MemoryRouter>
      </RoomProvider>,
      { container },
    );
    return container;
  }

  const scores = (client: HTMLElement) =>
    within(client).getAllByRole('listitem')
      .filter((li) => li.querySelector('.pts'))
      .map((li) => `${li.querySelector('.name')?.textContent}:${li.querySelector('.pts')?.textContent}`);

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

  // The word is typed into local state the tracker clears on dispatch, so a
  // refusal has to hand it back or the player loses what they typed.
  it('gives a refused word back to the player', async () => {
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

    await user.type(within(guest).getByLabelText('Word played'), 'quiz');
    await user.click(within(guest).getByRole('button', { name: 'Score turn' }));

    await waitFor(() =>
      expect(within(guest).getByRole('status')).toHaveTextContent(/not your turn/i));
    expect(scores(guest).find((r) => r.startsWith('Grace'))).toBe('Grace:0');
  });
});

/** Sharing starts a fresh game, so it must say what it is about to clear. */
describe('starting to share', () => {
  const solo = (children: React.ReactNode) => (
    <RoomProvider value={{ session: null }}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {children}
      </MemoryRouter>
    </RoomProvider>
  );

  it('warns, and names what is on screen, before clearing it', async () => {
    const user = userEvent.setup();
    localStorage.setItem('games.cricket.v1', JSON.stringify({
      players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }, { id: 'b', name: 'Bo', joinedAtTurn: 0 }],
      turns: [{ id: 't', playerId: 'a', darts: [{ target: 20, multiplier: 3 }] }],
      currentIndex: 0,
      variant: 'standard',
    }));

    render(solo(<CricketTracker />));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(screen.getByRole('status')).toHaveTextContent('2 players and 1 turn');
    // The button says what it does, rather than hiding it in the small print.
    expect(screen.getByRole('button', { name: /Clear and start sharing/ })).toBeInTheDocument();
  });

  it('says nothing when there is nothing to lose', async () => {
    const user = userEvent.setup();
    render(solo(<CricketTracker />));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(screen.queryByText(/will be cleared/)).not.toBeInTheDocument();
    // No warning styling either, so an empty game is a plain first step.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Start sharing$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear and/ })).not.toBeInTheDocument();
  });

  // A roster somebody typed out is worth warning about even before anyone has
  // thrown, because retyping it is the annoying part.
  it('warns about players alone, with no turns yet', async () => {
    const user = userEvent.setup();
    localStorage.setItem('games.cricket.v1', JSON.stringify({
      players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }],
      turns: [], currentIndex: 0, variant: 'standard',
    }));

    render(solo(<CricketTracker />));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(screen.getByRole('status')).toHaveTextContent('1 player');
    expect(screen.getByRole('status')).not.toHaveTextContent('turn');
  });

  it('does nothing until the button is pressed', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    localStorage.setItem('games.cricket.v1', JSON.stringify({
      players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }], turns: [], currentIndex: 0, variant: 'standard',
    }));

    render(solo(<CricketTracker />));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('games.cricket.v1')).toContain('Ada');
    vi.unstubAllGlobals();
  });
});

describe('playing alone', () => {
  const Solo = ({ children }: { children: ReactNode }) => (
    <RoomProvider value={{ session: null }}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {children}
      </MemoryRouter>
    </RoomProvider>
  );

  // The whole point of the refactor: solo play must be untouched, and must not
  // reach for the network even once.
  it('never constructs a socket and still saves to storage', async () => {
    const user = userEvent.setup();
    const original = globalThis.WebSocket;
    let constructed = 0;
    // @ts-expect-error - replaced for the duration of this test
    globalThis.WebSocket = class {
      constructor() {
        constructed += 1;
      }
    };

    render(<Solo><CricketTracker /></Solo>);
    await user.type(screen.getByLabelText('Player name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(constructed).toBe(0);
    expect(localStorage.getItem('games.cricket.v1')).toContain('Ada');
    expect(screen.queryByText('Who is here')).not.toBeInTheDocument();

    globalThis.WebSocket = original;
  });
});
