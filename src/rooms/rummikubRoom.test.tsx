/**
 * Rummikub in a room, host and guest side by side.
 *
 * A round records every rack at once, so it cannot be scoped to one seat the
 * way a dart or a word can. The host opens a round, everyone enters their own
 * tiles, and the host scores it. These drive that whole cycle through the real
 * protocol, and check the solo path is untouched by it.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RummikubTracker } from '../rummikub/RummikubTracker';
import { createTestRoom, type TestRoom } from './testRoom';
import type { StoredSession } from './storage';
import { countingSockets, mountClient, myRow, scoreboard } from './testClient';

type User = ReturnType<typeof userEvent.setup>;

const mount = (room: TestRoom, session: StoredSession, label: string) =>
  mountClient(RummikubTracker, { room, session, label });

const scores = scoreboard;

/** Host opens a round naming who went out. */
async function collect(user: User, host: HTMLElement, winner: string) {
  await user.click(within(host).getByRole('button', { name: winner }));
  await user.click(within(host).getByRole('button', { name: /Collect tiles/ }));
}

describe('opening a round', () => {
  it('is the host job, and guests are told to wait', async () => {
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    expect(within(host).getByRole('button', { name: /Collect tiles/ })).toBeInTheDocument();
    expect(within(guest).getByText(/Waiting for the host/)).toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: /Collect tiles/ })).not.toBeInTheDocument();
  });

  it('cannot be opened until somebody is named', async () => {
    const room = createTestRoom('rummikub');
    room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');

    await waitFor(() => expect(scores(host)).toHaveLength(2));
    expect(within(host).getByRole('button', { name: /Collect tiles/ })).toBeDisabled();
  });
});

describe('collecting the tiles', () => {
  it('asks each player for their own rack and nobody else\'s', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');

    // Grace is asked for hers; there is no field for anyone else.
    await waitFor(() =>
      expect(within(guest).getByLabelText('Your tiles left')).toBeInTheDocument());
    expect(within(guest).queryByLabelText(/Tiles left for/)).not.toBeInTheDocument();
  });

  it('tells the winner they have nothing to count', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Grace');

    await waitFor(() =>
      expect(within(guest).getByText(/nothing left to count/)).toBeInTheDocument());
    expect(within(guest).queryByLabelText('Your tiles left')).not.toBeInTheDocument();
  });

  it('shows everyone who is still to come in', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');
    await waitFor(() => expect(within(host).getByText('waiting for Grace')).toBeInTheDocument());

    await user.type(within(guest).getByLabelText('Your tiles left'), '24');
    await user.click(within(guest).getByRole('button', { name: 'Send your tiles' }));

    // Both sides see it land.
    await waitFor(() => expect(within(host).getByText('Grace 24')).toBeInTheDocument());
    expect(within(guest).getByText('Grace 24')).toBeInTheDocument();
  });

  it('lets a player correct their rack before it is scored', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');

    await user.type(within(guest).getByLabelText('Your tiles left'), '24');
    await user.click(within(guest).getByRole('button', { name: 'Send your tiles' }));
    await waitFor(() => expect(within(host).getByText('Grace 24')).toBeInTheDocument());

    await user.clear(within(guest).getByLabelText('Your tiles left'));
    await user.type(within(guest).getByLabelText('Your tiles left'), '42');
    await user.click(within(guest).getByRole('button', { name: 'Update your tiles' }));

    await waitFor(() => expect(within(host).getByText('Grace 42')).toBeInTheDocument());
  });

  it('adds up what the winner will score as the racks arrive', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');
    expect(within(host).getByTestId('round-pot')).toHaveTextContent('+0');

    await user.type(within(guest).getByLabelText('Your tiles left'), '24');
    await user.click(within(guest).getByRole('button', { name: 'Send your tiles' }));

    await waitFor(() => expect(within(host).getByTestId('round-pot')).toHaveTextContent('+24'));
  });
});

describe('scoring the round', () => {
  it('pays the winner what everyone was holding', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');

    await user.type(within(guest).getByLabelText('Your tiles left'), '24');
    await user.click(within(guest).getByRole('button', { name: 'Send your tiles' }));
    await waitFor(() => expect(within(host).getByText('Grace 24')).toBeInTheDocument());

    await user.click(within(host).getByRole('button', { name: /Score round/ }));

    await waitFor(() => expect(scores(host)).toEqual(['Host:24', 'Grace:-24']));
    expect(scores(guest)).toEqual(['Host:24', 'Grace:-24']);
  });

  it('goes back to opening a round afterwards', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');

    await waitFor(() => expect(scores(host)).toHaveLength(2));
    await collect(user, host, 'Host');
    await user.click(within(host).getByRole('button', { name: /Score round/ }));

    await waitFor(() =>
      expect(within(host).getByRole('button', { name: /Collect tiles/ })).toBeInTheDocument());
  });

  it('lets the host abandon a round', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');

    await waitFor(() => expect(scores(host)).toHaveLength(2));
    await collect(user, host, 'Host');
    await user.click(within(host).getByRole('button', { name: /Cancel/ }));

    await waitFor(() =>
      expect(within(host).getByRole('button', { name: /Collect tiles/ })).toBeInTheDocument());
    expect(scores(host)).toEqual(['Host:0', 'Grace:0']);
  });

  // Only the host commits, because the round is everyone's rather than anyone's.
  it('gives a guest no way to score or cancel it', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');
    await waitFor(() => expect(within(guest).getByLabelText('Your tiles left')).toBeInTheDocument());

    expect(within(guest).queryByRole('button', { name: /Score round/ })).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument();
  });

  it('lets the host enter a rack for somebody without a phone', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const host = mount(room, room.hostSession, 'host');

    // Ada has no phone, so the host types her in.
    await user.type(within(host).getByLabelText('Player name'), 'Ada');
    await user.click(within(host).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(scores(host)).toHaveLength(2));

    await collect(user, host, 'Host');
    await user.type(within(host).getByLabelText('Tiles left for Ada'), '15');
    await user.click(within(host).getByRole('button', { name: "Send Ada's tiles" }));

    await waitFor(() => expect(within(host).getByText('Ada 15')).toBeInTheDocument());
  });
});

/**
 * Rummikub gives a guest no game actions at all: rounds are collective, so
 * everything that changes the game is the host's, and a guest takes part by
 * sending their own rack. So none of the host's controls should be on offer.
 */
describe('controls a Rummikub guest may not use', () => {
  it('does not offer undo, which only the host may do here', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');
    await user.click(within(host).getByRole('button', { name: /Score round/ }));

    await waitFor(() =>
      expect(within(host).getByRole('button', { name: 'Undo last' })).toBeInTheDocument());
    expect(within(guest).queryByRole('button', { name: 'Undo last' })).not.toBeInTheDocument();
  });

  it('does not offer a guest the roster or the game controls', async () => {
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    expect(within(guest).queryByLabelText('Player name')).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'New game' })).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'Reset all' })).not.toBeInTheDocument();
  });

  it('marks which row on the board is you', async () => {
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    expect(myRow(guest)).toHaveTextContent('Grace');
  });

  it('leaves the host every one of them', async () => {
    const room = createTestRoom('rummikub');
    room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');

    await waitFor(() => expect(scores(host)).toHaveLength(2));
    expect(within(host).getByLabelText('Player name')).toBeInTheDocument();
    expect(within(host).getByRole('button', { name: 'New game' })).toBeInTheDocument();
  });
});

/** The room path must not have disturbed the game people play on their own. */
describe('playing Rummikub alone', () => {
  const solo = () => mountClient(RummikubTracker);

  it('still scores a round the old way, with no room in sight', async () => {
    const user = userEvent.setup();
    solo();

    await user.type(screen.getByLabelText('Player name'), 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));
    await user.type(screen.getByLabelText('Tiles left for Grace'), '24');
    await user.click(screen.getByRole('button', { name: 'Score round' }));

    expect(scoreboard()).toEqual(['Ada:24', 'Grace:-24']);
  });

  it('never constructs a socket', async () => {
    const user = userEvent.setup();
    const sockets = countingSockets();

    solo();
    await user.type(screen.getByLabelText('Player name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(sockets.count()).toBe(0);
    expect(localStorage.getItem('games.rummikub.v1')).toContain('Ada');
    sockets.restore();
  });

  it('shows the tile pad and the winner picker, not the room wording', async () => {
    const user = userEvent.setup();
    solo();
    await user.type(screen.getByLabelText('Player name'), 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('Who went out?')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the host/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Collect tiles/ })).not.toBeInTheDocument();
  });
});

describe('the shared tile pad', () => {
  it('counts a joker as 30 for a player entering their own rack', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');

    const pad = within(guest).getByRole('group', { name: 'Tile values' });
    await user.click(within(pad).getByRole('button', { name: 'Joker' }));
    await user.click(within(pad).getByRole('button', { name: '5' }));

    expect(within(guest).getByLabelText('Your tiles left')).toHaveValue(35);
  });

  it('takes the last tile back', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('rummikub');
    const guestSession = room.addMember('Grace');
    const host = mount(room, room.hostSession, 'host');
    const guest = mount(room, guestSession, 'guest');

    await waitFor(() => expect(scores(guest)).toHaveLength(2));
    await collect(user, host, 'Host');

    const pad = within(guest).getByRole('group', { name: 'Tile values' });
    await user.click(within(pad).getByRole('button', { name: '9' }));
    await user.click(within(pad).getByRole('button', { name: 'Joker' }));
    expect(within(guest).getByLabelText('Your tiles left')).toHaveValue(39);

    await user.click(within(guest).getByRole('button', { name: 'Remove last tile' }));
    expect(within(guest).getByLabelText('Your tiles left')).toHaveValue(9);
  });
});

describe('leaving mid-collection', () => {
  it('does not lose what the others have already sent', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const room = createTestRoom('rummikub');
    const a = room.addMember('Grace');
    const b = room.addMember('Alan');

    const host = mount(room, room.hostSession, 'host');
    const first = mount(room, a, 'a');
    mount(room, b, 'b');

    await waitFor(() => expect(scores(host)).toHaveLength(3));
    await collect(user, host, 'Host');

    await user.type(within(first).getByLabelText('Your tiles left'), '24');
    await user.click(within(first).getByRole('button', { name: 'Send your tiles' }));
    await waitFor(() => expect(within(host).getByText('Grace 24')).toBeInTheDocument());

    await user.click(within(first).getByRole('button', { name: 'Leave' }));

    // Grace's rack stays on the board even though she has gone.
    await waitFor(() => expect(within(host).getByText('Grace 24')).toBeInTheDocument());
    confirm.mockRestore();
  });
});
