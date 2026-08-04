/**
 * The name this device plays under.
 *
 * Typing your name is nearly the whole of joining, so it is worth not asking
 * twice. It is remembered in one place and offered back at every door: hosting,
 * joining, and any game. These cover the three writers and the two readers,
 * because a name saved but never offered back is the same as not saving it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CricketTracker } from '../cricket/CricketTracker';
import { HostRoomButton } from './HostRoomButton';
import { JoinRoom } from './JoinRoom';
import { RoomProvider } from './RoomProvider';
import { createTestRoom } from './testRoom';
import { readName, writeName } from './storage';
import * as api from './api';

const NAME_KEY = 'games.name.v1';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const wrap = (node: React.ReactNode) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {node}
  </MemoryRouter>
);

describe('what is remembered', () => {
  it('is nothing at all before you have played', () => {
    expect(readName()).toBe('');
  });

  it('round trips, trimmed', () => {
    writeName('  Ada  ');
    expect(readName()).toBe('Ada');
  });

  // The field caps at 24, but storage is written by code, not only by the field.
  it('is cut to the length the field allows', () => {
    writeName('A'.repeat(40));
    expect(readName()).toHaveLength(24);
  });

  it('survives storage being unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeName('Ada')).not.toThrow();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readName()).toBe('');
  });
});

describe('hosting a room', () => {
  /** The form lives behind the Share button. */
  const openShare = async (user: ReturnType<typeof userEvent.setup>) => {
    render(wrap(<HostRoomButton game="cricket" />));
    await user.click(screen.getByRole('button', { name: /Share/ }));
  };

  it('starts the field from the name last used', async () => {
    writeName('Ada');
    await openShare(userEvent.setup());

    expect(screen.getByLabelText('Your name')).toHaveValue('Ada');
  });

  it('starts empty the first time', async () => {
    await openShare(userEvent.setup());
    expect(screen.getByLabelText('Your name')).toHaveValue('');
  });

  it('remembers the name once the room exists', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'createRoom').mockResolvedValue({
      ok: true,
      value: { game: 'cricket', code: 'AB23', token: 't', memberId: 'm' },
    });
    // Hosting reloads to pick the session up; jsdom cannot, so it is stubbed.
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });

    await openShare(user);
    await user.type(screen.getByLabelText('Your name'), '  Ada  ');
    await user.click(screen.getByRole('button', { name: /Start sharing/ }));

    await waitFor(() => expect(localStorage.getItem(NAME_KEY)).toBe('Ada'));
  });

  // A name saved on a failed attempt would be a name they never played under.
  it('remembers nothing if the room could not be started', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'createRoom').mockResolvedValue({ ok: false, error: 'unreachable' });

    await openShare(user);
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.click(screen.getByRole('button', { name: /Start sharing/ }));

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(localStorage.getItem(NAME_KEY)).toBeNull();
  });
});

describe('joining a room', () => {
  it('starts the field from the name last used', () => {
    writeName('Grace');
    render(wrap(<JoinRoom />));

    expect(screen.getByLabelText('Your name')).toHaveValue('Grace');
  });

  it('remembers the name once the join lands', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'peekRoom').mockResolvedValue({ ok: true, value: { game: 'cricket', open: true } });
    vi.spyOn(api, 'joinRoom').mockResolvedValue({
      ok: true,
      value: { game: 'cricket', code: 'AB23', token: 't', memberId: 'm' },
    });
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });

    render(wrap(<JoinRoom />));
    await user.type(screen.getByLabelText('Room code'), 'AB23');
    await user.type(screen.getByLabelText('Your name'), 'Grace');
    await user.click(screen.getByRole('button', { name: /Join/ }));

    await waitFor(() => expect(localStorage.getItem(NAME_KEY)).toBe('Grace'));
  });

  it('remembers nothing when the code matched no room', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'peekRoom').mockResolvedValue({ ok: false, error: 'no-room' });

    render(wrap(<JoinRoom />));
    await user.type(screen.getByLabelText('Room code'), 'AB23');
    await user.type(screen.getByLabelText('Your name'), 'Grace');
    await user.click(screen.getByRole('button', { name: /Join/ }));

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(localStorage.getItem(NAME_KEY)).toBeNull();
  });
});

/**
 * The gap this closes: correcting your name in the room used to leave the old
 * one saved, so the next room offered a name you had already rejected.
 */
describe('renaming yourself in a room', () => {
  const inRoom = () => {
    const room = createTestRoom('cricket');
    render(
      <RoomProvider value={{ transport: room.transport(), session: room.hostSession }}>
        {wrap(<CricketTracker />)}
      </RoomProvider>,
    );
    return room;
  };

  it('makes the new name the one offered next time', async () => {
    const user = userEvent.setup();
    writeName('Host');
    inRoom();

    await waitFor(() => expect(screen.getByRole('button', { name: /Who is here/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Who is here/ }));
    await user.click(screen.getByRole('button', { name: /Change name/ }));

    const field = screen.getByLabelText('Your name');
    await user.clear(field);
    await user.type(field, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(readName()).toBe('Ada'));
  });

  it('leaves it alone when the name is unchanged', async () => {
    const user = userEvent.setup();
    writeName('Grace');
    inRoom();

    await waitFor(() => expect(screen.getByRole('button', { name: /Who is here/ })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /Who is here/ }));
    await user.click(screen.getByRole('button', { name: /Change name/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(readName()).toBe('Grace');
  });
});
