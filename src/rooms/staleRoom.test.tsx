/**
 * Rooms that are not there any more.
 *
 * Reported as flickering: a device that still remembered a room which had since
 * ended would open a socket, be refused, and try again forever, so the top bar
 * alternated between getting back to the room and not being connected. The room
 * now says why it will not have the device back, and the device forgets it -
 * this time and next time.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CricketTracker } from '../cricket/CricketTracker';
import { RoomProvider } from './RoomProvider';
import { createTestRoom } from './testRoom';
import { writeSession, readSession } from './storage';
import type { GoneReason } from '@shared/rooms/protocol';
import type { TransportFactory } from './transport';

const SESSION = { game: 'cricket', code: 'QGZ7', token: 'tok', memberId: 'm1' } as const;

beforeEach(() => localStorage.clear());

const wrap = (node: ReactNode) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {node}
  </MemoryRouter>
);

/** Counts every socket the app tries to open, however it ends. */
function countingTransport(): { factory: TransportFactory; opened: () => number } {
  let opened = 0;
  const factory: TransportFactory = () => {
    opened += 1;
    return { send: () => {}, close: () => {} };
  };
  return { factory, opened: () => opened };
}

/** A room that turns this device away the moment it arrives. */
function refusing(reason: GoneReason): { factory: TransportFactory; opened: () => number } {
  let opened = 0;
  const factory: TransportFactory = ({ handlers }) => {
    opened += 1;
    handlers.onStatus('offline');
    handlers.onGone(reason);
    return { send: () => {}, close: () => {} };
  };
  return { factory, opened: () => opened };
}

describe('opening a game that remembers a room which has ended', () => {
  it('says what happened rather than sitting there not connected', async () => {
    writeSession(SESSION);
    render(<RoomProvider value={{ transport: refusing('ended').factory }}>{wrap(<CricketTracker />)}</RoomProvider>);

    await waitFor(() =>
      expect(screen.getByText(/That room has ended/)).toBeInTheDocument());
  });

  it('forgets the room, so nothing tries it again', async () => {
    writeSession(SESSION);
    render(<RoomProvider value={{ transport: refusing('ended').factory }}>{wrap(<CricketTracker />)}</RoomProvider>);

    await waitFor(() => expect(readSession('cricket')).toBeNull());
  });

  // The heart of the bug: on the next visit there is nothing left to retry.
  it('opens no socket at all the next time the game is opened', async () => {
    writeSession(SESSION);
    const first = refusing('ended');
    const { unmount } = render(
      <RoomProvider value={{ transport: first.factory }}>{wrap(<CricketTracker />)}</RoomProvider>,
    );
    await waitFor(() => expect(readSession('cricket')).toBeNull());
    unmount();

    const second = countingTransport();
    render(<RoomProvider value={{ transport: second.factory }}>{wrap(<CricketTracker />)}</RoomProvider>);

    expect(second.opened()).toBe(0);
    expect(first.opened()).toBe(1);
  });

  it('puts the room strip away, because there is no room', async () => {
    writeSession(SESSION);
    render(<RoomProvider value={{ transport: refusing('ended').factory }}>{wrap(<CricketTracker />)}</RoomProvider>);

    await waitFor(() => expect(screen.getByText(/That room has ended/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Who is here/ })).not.toBeInTheDocument();
  });

  it('gives the game back that was on this device', async () => {
    writeSession(SESSION);
    // A game of their own, from before any of this.
    localStorage.setItem('games.cricket.v1', JSON.stringify({
      players: [{ id: 'p1', name: 'Solo Ada', joinedAtTurn: 0 }],
      turns: [],
      currentIndex: 0,
      variant: 'standard',
    }));

    render(<RoomProvider value={{ transport: refusing('ended').factory }}>{wrap(<CricketTracker />)}</RoomProvider>);

    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Solo Ada')).toBeInTheDocument());
    // And it is still theirs afterwards, not overwritten by the room's game.
    expect(localStorage.getItem('games.cricket.v1')).toContain('Solo Ada');
  });

  it('can be put away once it has been read', async () => {
    const user = userEvent.setup();
    writeSession(SESSION);
    render(<RoomProvider value={{ transport: refusing('ended').factory }}>{wrap(<CricketTracker />)}</RoomProvider>);

    await waitFor(() => expect(screen.getByText(/That room has ended/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Hide' }));

    expect(screen.queryByText(/That room has ended/)).not.toBeInTheDocument();
  });

  it.each([
    ['removed', /removed you from that room/],
    ['unauthorised', /did not recognise this device/],
  ] as [GoneReason, RegExp][])('explains being turned away as %s', async (reason, wording) => {
    writeSession(SESSION);
    render(<RoomProvider value={{ transport: refusing(reason).factory }}>{wrap(<CricketTracker />)}</RoomProvider>);

    await waitFor(() => expect(screen.getByText(wording)).toBeInTheDocument());
  });
});

/** The same thing, but happening while somebody is looking at the game. */
describe('a room that ends mid-game', () => {
  const mount = (room: ReturnType<typeof createTestRoom>, session: typeof SESSION | undefined, label: string) => {
    const container = document.createElement('div');
    container.dataset.client = label;
    document.body.append(container);
    render(
      <RoomProvider value={{ transport: room.transport(), session: session ?? room.hostSession }}>
        {wrap(<CricketTracker />)}
      </RoomProvider>,
      { container },
    );
    return container;
  };

  it('tells a guest when the host closes it', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, undefined, 'host');
    const guest = mount(room, guestSession as typeof SESSION, 'guest');

    await waitFor(() => expect(within(guest).getByRole('table')).toBeInTheDocument());
    await user.click(within(host).getByRole('button', { name: /Who is here/ }));
    await user.click(within(host).getByRole('button', { name: /Close room/ }));

    await waitFor(() =>
      expect(within(guest).getByText(/That room has ended/)).toBeInTheDocument());
  });

  it('tells a guest when the host removes them', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, undefined, 'host');
    const guest = mount(room, guestSession as typeof SESSION, 'guest');

    await waitFor(() => expect(within(guest).getByRole('table')).toBeInTheDocument());
    await user.click(within(host).getByRole('button', { name: /Who is here/ }));
    await user.click(within(host).getByRole('button', { name: 'Remove Grace from the room' }));

    await waitFor(() =>
      expect(within(guest).getByText(/removed you from that room/)).toBeInTheDocument());
  });

  // Nobody needs telling about a door they shut themselves.
  it('says nothing to a guest who chose to leave', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    mount(room, undefined, 'host');
    const guest = mount(room, guestSession as typeof SESSION, 'guest');

    await waitFor(() => expect(within(guest).getByRole('table')).toBeInTheDocument());
    await user.click(within(guest).getByRole('button', { name: 'Leave' }));

    await waitFor(() =>
      expect(within(guest).queryByRole('button', { name: /Who is here/ })).not.toBeInTheDocument());
    expect(within(guest).queryByText(/room has ended/)).not.toBeInTheDocument();
    expect(within(guest).queryByText(/removed you/)).not.toBeInTheDocument();
  });

  it('leaves the host with the game they were sharing', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('cricket');
    const host = mount(room, undefined, 'host');

    await user.type(within(host).getByLabelText('Player name'), 'Ada');
    await user.click(within(host).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(within(within(host).getByRole('table')).getByText('Ada')).toBeInTheDocument());

    await user.click(within(host).getByRole('button', { name: /Who is here/ }));
    await user.click(within(host).getByRole('button', { name: /Close room/ }));

    await waitFor(() => expect(readSession('cricket')).toBeNull());
    expect(localStorage.getItem('games.cricket.v1')).toContain('Ada');
  });
});
