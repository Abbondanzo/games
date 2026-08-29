/**
 * A Yahtzee sheet shared between two devices.
 *
 * The host and one guest are rendered side by side against a real room, so the
 * question these answer is the one the trackers' own tests cannot: what each of
 * them is allowed to write on, and what happens on the other screen when they
 * do.
 */
import { describe, expect, it } from 'vitest';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YahtzeeTracker } from '../yahtzee/YahtzeeTracker';
import { createTestRoom } from './testRoom';
import {
  boardColumns,
  boardTotals,
  countingSockets,
  mountClient,
  mountPair,
  myColumn,
} from './testClient';

type User = ReturnType<typeof userEvent.setup>;

async function addPlayers(user: User, client: HTMLElement, names: string) {
  await user.type(within(client).getByLabelText('Player name'), names);
  await user.click(within(client).getByRole('button', { name: 'Add' }));
}

/** Tap the box, then the answer, on one particular device. */
async function fill(
  user: User,
  client: HTMLElement,
  name: string,
  box: string,
  value: number | 'scratch',
) {
  await user.click(within(client).getByRole('button', { name: `Score ${box} for ${name}` }));
  // Every box here is an upper one, where the key is how many dice showed the
  // face and carries the total it comes to.
  await user.click(
    within(client).getByRole('button', {
      name: value === 'scratch' ? 'Scratch this box' : new RegExp(`total ${value}$`),
    }),
  );
}

const room = () => {
  const created = createTestRoom('yahtzee');
  return { created, guest: created.addMember('Grace') };
};

describe('a host and a guest sharing a sheet', () => {
  it('shows the guest a box the host filled in', async () => {
    const user = userEvent.setup();
    const { created, guest: guestSession } = room();
    const { host, guest } = mountPair(YahtzeeTracker, created, guestSession);

    await waitFor(() => expect(boardColumns(host)).toEqual(['Host', 'Grace']));
    await fill(user, host, 'Host', 'Sixes', 24);

    await waitFor(() => expect(boardTotals(guest)).toEqual(['Host:24', 'Grace:0']));
  });

  it('marks the guest their own column', async () => {
    const { created, guest: guestSession } = room();
    const { guest } = mountPair(YahtzeeTracker, created, guestSession);

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    expect(myColumn(guest)?.querySelector('.name')?.textContent).toBe('Grace');
  });

  /**
   * A guest may write on their own sheet and nobody else's. A box that would
   * only ever refuse is plain text rather than a button, so there is nothing
   * to tap in the first place.
   */
  it('gives the guest no box at all on somebody else’s sheet', async () => {
    const { created, guest: guestSession } = room();
    const { guest } = mountPair(YahtzeeTracker, created, guestSession);

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    expect(
      within(guest).queryByRole('button', { name: 'Score Sixes for Host' }),
    ).not.toBeInTheDocument();
    expect(
      within(guest).getByRole('button', { name: 'Score Sixes for Grace' }),
    ).toBeInTheDocument();
  });

  it('lets the guest fill their own box when it is their turn', async () => {
    const user = userEvent.setup();
    const { created, guest: guestSession } = room();
    const { host, guest } = mountPair(YahtzeeTracker, created, guestSession);

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    // The host goes first, which hands the turn to Grace.
    await fill(user, host, 'Host', 'Ones', 3);

    await waitFor(() =>
      expect(within(guest).getByRole('button', { name: 'Score Ones for Grace' })).toBeEnabled(),
    );
    await fill(user, guest, 'Grace', 'Ones', 2);

    await waitFor(() => expect(boardTotals(host)).toEqual(['Host:3', 'Grace:2']));
  });

  it('closes the guest’s own boxes off until their turn comes round', async () => {
    const { created, guest: guestSession } = room();
    const { guest } = mountPair(YahtzeeTracker, created, guestSession);

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    // The host is up, so Grace's boxes are on offer but not yet hers to fill.
    expect(within(guest).getByRole('button', { name: 'Score Ones for Grace' })).toBeDisabled();
  });

  it('keeps the roster out of a guest’s hands', async () => {
    const { created, guest: guestSession } = room();
    const { guest } = mountPair(YahtzeeTracker, created, guestSession);

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    expect(within(guest).queryByLabelText('Player name')).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'New game' })).not.toBeInTheDocument();
  });
});

describe('playing alone', () => {
  it('opens no socket and keeps writing to this device', async () => {
    const user = userEvent.setup();
    const sockets = countingSockets();

    const client = mountClient(YahtzeeTracker);
    await addPlayers(user, client, 'Ada');
    await fill(user, client, 'Ada', 'Sixes', 24);

    expect(sockets.count()).toBe(0);
    expect(localStorage.getItem('games.yahtzee.v1')).toContain('Ada');
    expect(within(client).queryByText('Who is here')).not.toBeInTheDocument();

    sockets.restore();
  });
});
