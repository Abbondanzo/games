/**
 * Two devices, one room, one process.
 *
 * A host and a guest are rendered side by side and driven through the real
 * protocol against a real RoomCore. This is the test that would actually catch
 * a rooms regression, and it needs no network at all.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CricketTracker } from '../cricket/CricketTracker';
import { RoomProvider } from './RoomProvider';
import { createTestRoom, type TestRoom } from './testRoom';
import type { StoredSession } from './storage';

type User = ReturnType<typeof userEvent.setup>;

/** Renders one client into its own container, so the two never collide. */
function mount(room: TestRoom, session: StoredSession, label: string): HTMLElement {
  const host = document.createElement('div');
  host.dataset.client = label;
  document.body.append(host);
  render(
    <RoomProvider value={{ transport: room.transport, session }}>
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

    await addPlayers(user, host, 'Ada, Grace');

    // The guest sees the roster appear without doing anything.
    await waitFor(() => expect(players(guest)).toEqual(['Ada', 'Grace']));
  });

  it('lets a guest claim a seat and score on their own turn', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await addPlayers(user, host, 'Ada, Grace');
    await waitFor(() => expect(players(guest)).toEqual(['Ada', 'Grace']));

    // Ada is up first, so the guest takes that seat to be able to throw.
    await user.click(await within(guest).findByRole('button', { name: 'Play as Ada' }));
    await waitFor(() =>
      expect(within(guest).queryByText('Which one are you?')).not.toBeInTheDocument());

    await throwDart(user, guest, 'Triple', 'Triple 20');
    await user.click(within(guest).getByRole('button', { name: 'End turn' }));

    // Both sides agree, because both are rendering the room's own snapshot.
    await waitFor(() => expect(marksOn(host, '20', 0)).toContain('closed'));
    expect(marksOn(guest, '20', 0)).toContain('closed');
  });

  it('refuses a guest a turn that is not theirs, and says whose it is', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await addPlayers(user, host, 'Ada, Grace');
    await waitFor(() => expect(players(guest)).toEqual(['Ada', 'Grace']));

    // Takes Grace's seat while Ada is the one up.
    await user.click(await within(guest).findByRole('button', { name: 'Play as Grace' }));
    await waitFor(() => expect(within(guest).getByText(/Now throwing/)).toHaveTextContent('Ada'));

    // The controls are closed off rather than failing after the fact.
    expect(within(guest).getByRole('button', { name: 'Miss' })).toBeDisabled();
    expect(marksOn(host, '20', 1)).toContain('no marks');
  });

  it('hides the host controls from a guest', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');

    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await addPlayers(user, host, 'Ada, Grace');
    await waitFor(() => expect(players(guest)).toEqual(['Ada', 'Grace']));

    for (const label of ['New game', 'Reset all']) {
      expect(within(host).getByRole('button', { name: label })).toBeInTheDocument();
      expect(within(guest).queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(within(guest).queryByLabelText('Player name')).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'Cut-throat' })).not.toBeInTheDocument();
  });

  it('gives a seat to whoever asks first', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const first = room.addMember('Grace');
    const second = room.addMember('Alan');

    const host = mount(room, room.hostSession, 'host');
    const a = mount(room, first, 'a');
    const b = mount(room, second, 'b');

    await addPlayers(user, host, 'Ada, Grace');
    await waitFor(() => expect(players(a)).toEqual(['Ada', 'Grace']));

    await user.click(await within(a).findByRole('button', { name: 'Play as Ada' }));
    await waitFor(() => expect(room.state().members[first.memberId]?.seatId).toBeTruthy());

    // The seat is gone, so it is no longer offered to the second player.
    await waitFor(() =>
      expect(within(b).queryByRole('button', { name: 'Play as Ada' })).not.toBeInTheDocument());
    expect(room.state().members[second.memberId]?.seatId).toBeNull();
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

  it('keeps the room code on screen for both of them', async () => {
    const room = createTestRoom('cricket');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(within(host).getByText('AB2D')).toBeInTheDocument());
    expect(within(guest).getByText('AB2D')).toBeInTheDocument();
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
