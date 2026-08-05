/**
 * Scrabble in a room, from a guest's side.
 *
 * Two things: a guest should never meet a control whose only answer is "only
 * the host can do that", and whose turn it is should be readable at a glance.
 * At a table everyone is looking at their own phone, so a name on its own
 * makes each of them work out whether that name is theirs.
 */
import { describe, expect, it } from 'vitest';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrabbleTracker } from '../scrabble/ScrabbleTracker';
import { createTestRoom } from './testRoom';
import { mountClient, mountPair, myRow, playerNames, scoreboard } from './testClient';

type User = ReturnType<typeof userEvent.setup>;

const names = playerNames;

/** Sets up a host and one guest, with the guest's own player made. */
async function table() {
  const room = createTestRoom('scrabble');
  const { host, guest } = mountPair(ScrabbleTracker, room, room.addMember('Grace'));
  await waitFor(() => expect(names(guest)).toEqual(['Host', 'Grace']));
  return { room, host, guest };
}

/** The host hands the turn to whoever is named. */
async function handTurnTo(user: User, host: HTMLElement, name: string) {
  await user.click(within(host).getByTitle(`Make it ${name}'s turn`));
}

describe('controls a guest may not use', () => {
  it('does not offer the turn pointer, which is the host to move', async () => {
    const { host, guest } = await table();

    expect(within(host).getByTitle("Make it Grace's turn")).toBeInTheDocument();
    expect(within(guest).queryByTitle("Make it Grace's turn")).not.toBeInTheDocument();
    expect(within(guest).queryByTitle("Make it Host's turn")).not.toBeInTheDocument();
  });

  it('still shows a guest the whole scoreboard', async () => {
    const { guest } = await table();
    expect(names(guest)).toEqual(['Host', 'Grace']);
  });

  it('does not offer a guest the end-of-game adjustment', async () => {
    const { host, guest } = await table();

    expect(within(host).getByLabelText('Adjustment points')).toBeInTheDocument();
    expect(within(guest).queryByLabelText('Adjustment points')).not.toBeInTheDocument();
    expect(within(guest).queryByLabelText('Player to adjust')).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });

  it('does not offer a guest the roster or the game controls', async () => {
    const { guest } = await table();

    expect(within(guest).queryByLabelText('Player name')).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'New game' })).not.toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'Reset all' })).not.toBeInTheDocument();
  });

  // Undo is not host-only: it is yours while the last turn is yours.
  it('offers undo to whoever played the last turn, and nobody else', async () => {
    const user = userEvent.setup();
    const { host, guest } = await table();

    await handTurnTo(user, host, 'Grace');
    await user.type(within(guest).getByLabelText('Word played'), 'quiz');
    await user.click(within(guest).getByRole('button', { name: 'Score turn' }));

    await waitFor(() =>
      expect(within(guest).getByRole('button', { name: 'Undo last' })).toBeInTheDocument(),
    );
    // The host may always undo; the point is that a guest whose turn it was not
    // is not shown a button that would be refused.
    await handTurnTo(user, host, 'Host');
    await user.type(within(host).getByLabelText('Word played'), 'jazz');
    await user.click(within(host).getByRole('button', { name: 'Score turn' }));

    await waitFor(() =>
      expect(within(guest).queryByRole('button', { name: 'Undo last' })).not.toBeInTheDocument(),
    );
  });
});

describe('the host', () => {
  it('keeps every one of those controls', async () => {
    const { host } = await table();

    expect(within(host).getByTitle("Make it Grace's turn")).toBeInTheDocument();
    expect(within(host).getByLabelText('Adjustment points')).toBeInTheDocument();
    expect(within(host).getByLabelText('Player name')).toBeInTheDocument();
    expect(within(host).getByRole('button', { name: 'New game' })).toBeInTheDocument();
  });
});

describe('knowing whether it is your turn', () => {
  it('says so outright rather than naming somebody', async () => {
    const user = userEvent.setup();
    const { host, guest } = await table();

    await handTurnTo(user, host, 'Grace');

    await waitFor(() => expect(within(guest).getByText('Your turn')).toBeInTheDocument());
    // And the host, for whom it is not, is told who they are waiting on.
    expect(within(host).getByText(/Waiting for/)).toHaveTextContent('Grace');
  });

  it('names who is holding things up when it is not yours', async () => {
    const user = userEvent.setup();
    const { host, guest } = await table();

    await handTurnTo(user, host, 'Host');

    await waitFor(() => expect(within(guest).getByText(/Waiting for/)).toHaveTextContent('Host'));
    expect(within(guest).queryByText('Your turn')).not.toBeInTheDocument();
  });

  it('marks which player on the board is you', async () => {
    const { guest } = await table();

    const mine = myRow(guest);
    expect(mine).toHaveTextContent('Grace');
    expect(mine).toHaveClass('mine');
  });

  it('marks nobody as you on the host device when the host is the host', async () => {
    const { host } = await table();
    expect(myRow(host)).toHaveTextContent('Host');
  });

  it('shows the entry as yours to use, and closes it when it is not', async () => {
    const user = userEvent.setup();
    const { host, guest } = await table();

    await handTurnTo(user, host, 'Grace');
    await waitFor(() =>
      expect(within(guest).getByRole('button', { name: 'Score turn' })).toBeEnabled(),
    );
    expect(within(guest).getByText('Your turn').closest('.card')).toHaveClass('yours');

    await handTurnTo(user, host, 'Host');
    await waitFor(() =>
      expect(within(guest).getByRole('button', { name: 'Score turn' })).toBeDisabled(),
    );
    expect(
      within(guest)
        .getByText(/Waiting for/)
        .closest('.card'),
    ).toHaveClass('theirs');
  });

  it('is announced, so it does not have to be noticed', async () => {
    const user = userEvent.setup();
    const { host, guest } = await table();

    await handTurnTo(user, host, 'Grace');
    await waitFor(() => {
      const live = within(guest)
        .getAllByRole('status')
        .find((el) => el.classList.contains('whose-turn'));
      expect(live).toHaveTextContent('Your turn');
    });
  });
});

/** None of this should have reached the game people play on their own. */
describe('playing alone', () => {
  const solo = () => mountClient(ScrabbleTracker);

  it('still says who is playing, without any talk of turns being yours', async () => {
    const user = userEvent.setup();
    const client = solo();

    await user.type(within(client).getByLabelText('Player name'), 'Ada, Grace');
    await user.click(within(client).getByRole('button', { name: 'Add' }));

    expect(within(client).getByText(/Now playing/)).toHaveTextContent('Ada');
    expect(within(client).queryByText('Your turn')).not.toBeInTheDocument();
    expect(within(client).queryByText(/Waiting for/)).not.toBeInTheDocument();
  });

  it('keeps every control, and marks nobody as you', async () => {
    const user = userEvent.setup();
    const client = solo();

    await user.type(within(client).getByLabelText('Player name'), 'Ada, Grace');
    await user.click(within(client).getByRole('button', { name: 'Add' }));

    expect(within(client).getByTitle("Make it Grace's turn")).toBeInTheDocument();
    expect(within(client).getByLabelText('Adjustment points')).toBeInTheDocument();
    expect(within(client).queryByText('you')).not.toBeInTheDocument();
  });

  it('lets one person take every turn, as it always did', async () => {
    const user = userEvent.setup();
    const client = solo();

    await user.type(within(client).getByLabelText('Player name'), 'Ada, Grace');
    await user.click(within(client).getByRole('button', { name: 'Add' }));

    await user.type(within(client).getByLabelText('Word played'), 'quiz');
    await user.click(within(client).getByRole('button', { name: 'Score turn' }));
    await user.type(within(client).getByLabelText('Word played'), 'jazz');
    await user.click(within(client).getByRole('button', { name: 'Score turn' }));

    expect(scoreboard(client)).toEqual(['Grace:29', 'Ada:22']); // the board ranks by score
  });
});
