/**
 * Setting the play order, and handing the room over.
 *
 * Both are the host's, and both are about the shape of the game rather than
 * the score in it - which is why the room refuses either from anybody else,
 * and why order is fixed once the first turn has been played.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CricketTracker } from '../cricket/CricketTracker';
import { ScrabbleTracker } from '../scrabble/ScrabbleTracker';
import { RummikubTracker } from '../rummikub/RummikubTracker';
import { createTestRoom } from './testRoom';
import { boardColumns, mountClient, mountPair, playerNames } from './testClient';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => localStorage.clear());

const roster = (client: HTMLElement) =>
  within(client)
    .getAllByRole('listitem')
    .filter((li) => li.querySelector('.order'))
    .map((li) => li.querySelector('.order')?.textContent ?? '');

/** Names as the roster editor lists them, which is the order they play in. */
const order = (client: HTMLElement) =>
  within(client)
    .getAllByRole('listitem')
    .filter((li) => li.querySelector('.order'))
    .map((li) => li.textContent?.replace(/^\d+/, '') ?? '');

async function addPlayers(user: User, client: HTMLElement, names: string) {
  await user.type(within(client).getByLabelText('Player name'), names);
  await user.click(within(client).getByRole('button', { name: 'Add' }));
}

describe('setting the play order alone', () => {
  it('moves a player later, and everyone else keeps their order', async () => {
    const user = userEvent.setup();
    const client = mountClient(ScrabbleTracker);
    await addPlayers(user, client, 'Ada, Grace, Alan');

    await user.click(within(client).getByRole('button', { name: 'Move Ada later' }));

    expect(order(client)).toEqual(['Grace', 'Ada', 'Alan']);
    expect(roster(client)).toEqual(['1', '2', '3']);
  });

  it('moves a player earlier', async () => {
    const user = userEvent.setup();
    const client = mountClient(ScrabbleTracker);
    await addPlayers(user, client, 'Ada, Grace, Alan');

    await user.click(within(client).getByRole('button', { name: 'Move Alan earlier' }));
    expect(order(client)).toEqual(['Ada', 'Alan', 'Grace']);
  });

  it('offers nobody a way off the end of the list', async () => {
    const user = userEvent.setup();
    const client = mountClient(ScrabbleTracker);
    await addPlayers(user, client, 'Ada, Grace');

    expect(within(client).getByRole('button', { name: 'Move Ada earlier' })).toBeDisabled();
    expect(within(client).getByRole('button', { name: 'Move Grace later' })).toBeDisabled();
    expect(within(client).getByRole('button', { name: 'Move Ada later' })).toBeEnabled();
  });

  it('says nothing about order with only one player', async () => {
    const user = userEvent.setup();
    const client = mountClient(ScrabbleTracker);
    await addPlayers(user, client, 'Ada');

    expect(within(client).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
  });

  it('changes who plays first', async () => {
    const user = userEvent.setup();
    const client = mountClient(ScrabbleTracker);
    await addPlayers(user, client, 'Ada, Grace');

    await user.click(within(client).getByRole('button', { name: 'Move Grace earlier' }));
    expect(within(client).getByText(/Now playing/)).toHaveTextContent('Grace');
  });

  it('survives a reload, because it is the game state that moved', async () => {
    const user = userEvent.setup();
    const first = mountClient(ScrabbleTracker);
    await addPlayers(user, first, 'Ada, Grace, Alan');
    await user.click(within(first).getByRole('button', { name: 'Move Alan earlier' }));
    first.remove();

    const second = mountClient(ScrabbleTracker);
    await waitFor(() => expect(order(second)).toEqual(['Ada', 'Alan', 'Grace']));
  });
});

/**
 * The rule that keeps this safe. Moving somebody once play has started would
 * hand the turn to a different player and shuffle a history read as a sequence.
 */
describe('once the game has started', () => {
  it('fixes the Scrabble order at the first turn', async () => {
    const user = userEvent.setup();
    const client = mountClient(ScrabbleTracker);
    await addPlayers(user, client, 'Ada, Grace');
    expect(within(client).getByRole('button', { name: 'Move Ada later' })).toBeInTheDocument();

    await user.type(within(client).getByLabelText('Word played'), 'quiz');
    await user.click(within(client).getByRole('button', { name: 'Score turn' }));

    expect(within(client).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
  });

  it('fixes the cricket order at the first throw', async () => {
    const user = userEvent.setup();
    const client = mountClient(CricketTracker);
    await addPlayers(user, client, 'Ada, Grace');
    expect(within(client).getByRole('button', { name: 'Move Ada later' })).toBeInTheDocument();

    await user.click(within(client).getByRole('button', { name: 'Triple' }));
    await user.click(within(client).getByRole('button', { name: 'Triple 20' }));
    await user.click(within(client).getByRole('button', { name: 'End turn' }));

    expect(within(client).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
  });

  it('fixes the Rummikub order at the first round', async () => {
    const user = userEvent.setup();
    const client = mountClient(RummikubTracker);
    await addPlayers(user, client, 'Ada, Grace');
    expect(within(client).getByRole('button', { name: 'Move Ada later' })).toBeInTheDocument();

    await user.click(within(client).getByRole('button', { name: 'Ada', pressed: false }));
    await user.type(within(client).getByLabelText('Tiles left for Grace'), '24');
    await user.click(within(client).getByRole('button', { name: 'Score round' }));

    expect(within(client).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
  });

  it('is offered again once a new game clears the turns', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const client = mountClient(ScrabbleTracker);
    await addPlayers(user, client, 'Ada, Grace');

    await user.type(within(client).getByLabelText('Word played'), 'quiz');
    await user.click(within(client).getByRole('button', { name: 'Score turn' }));
    await user.click(within(client).getByRole('button', { name: 'New game' }));

    await waitFor(() =>
      expect(within(client).getByRole('button', { name: 'Move Ada later' })).toBeInTheDocument(),
    );
  });
});

describe('setting the play order in a room', () => {
  it('shows everyone the new order', async () => {
    const user = userEvent.setup();
    const room = createTestRoom('cricket');
    const { host, guest } = mountPair(CricketTracker, room, room.addMember('Grace'));

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    await user.click(within(host).getByRole('button', { name: 'Move Grace earlier' }));

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Grace', 'Host']));
  });

  it("is not a guest's to change", async () => {
    const room = createTestRoom('cricket');
    const { host, guest } = mountPair(CricketTracker, room, room.addMember('Grace'));

    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    expect(within(host).getByRole('button', { name: 'Move Grace earlier' })).toBeInTheDocument();
    // The whole roster editor is the host's, so there is nothing to press.
    expect(within(guest).queryByRole('button', { name: /^Move/ })).not.toBeInTheDocument();
  });
});

describe('handing the room over', () => {
  const table = async () => {
    const room = createTestRoom('cricket');
    const { host, guest } = mountPair(CricketTracker, room, room.addMember('Grace'));
    await waitFor(() => expect(playerNames(guest)).toHaveLength(0));
    await waitFor(() => expect(boardColumns(guest)).toEqual(['Host', 'Grace']));
    return { room, host, guest };
  };

  /** Opens the panel where the member list and its controls live. */
  const openPanel = async (user: User, client: HTMLElement) =>
    user.click(within(client).getByRole('button', { name: /Who is here/ }));

  it('is offered for everyone but yourself', async () => {
    const user = userEvent.setup();
    const { host } = await table();

    await openPanel(user, host);
    expect(
      within(host).getByRole('button', { name: 'Put Grace in charge of the room' }),
    ).toBeInTheDocument();
    expect(
      within(host).queryByRole('button', { name: /Put Host in charge/ }),
    ).not.toBeInTheDocument();
  });

  it('is not offered to a guest at all', async () => {
    const user = userEvent.setup();
    const { guest } = await table();

    await openPanel(user, guest);
    expect(within(guest).queryByRole('button', { name: /in charge/ })).not.toBeInTheDocument();
  });

  it('asks first, since it gives away as much as it grants', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { host, guest } = await table();

    await openPanel(user, host);
    await user.click(within(host).getByRole('button', { name: 'Put Grace in charge of the room' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Grace'));
    // Refused, so nothing moved.
    expect(within(host).getByRole('button', { name: 'New game' })).toBeInTheDocument();
    expect(within(guest).queryByRole('button', { name: 'New game' })).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it('moves the host controls across', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { host, guest } = await table();

    await openPanel(user, host);
    await user.click(within(host).getByRole('button', { name: 'Put Grace in charge of the room' }));

    await waitFor(() =>
      expect(within(guest).getByRole('button', { name: 'New game' })).toBeInTheDocument(),
    );
    expect(within(host).queryByRole('button', { name: 'New game' })).not.toBeInTheDocument();
  });

  it('lets the new host do what a host does', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { host, guest } = await table();

    await openPanel(user, host);
    await user.click(within(host).getByRole('button', { name: 'Put Grace in charge of the room' }));
    await waitFor(() => expect(within(guest).getByLabelText('Player name')).toBeInTheDocument());

    await addPlayers(user, guest, 'Alan');
    await waitFor(() => expect(boardColumns(host)).toEqual(['Host', 'Grace', 'Alan']));
  });

  /** A host cannot leave, so this is how somebody going home hands it on. */
  it('lets the old host leave, which they could not before', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { host, guest } = await table();

    expect(within(host).queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument();

    await openPanel(user, host);
    await user.click(within(host).getByRole('button', { name: 'Put Grace in charge of the room' }));

    await waitFor(() =>
      expect(within(host).getByRole('button', { name: 'Leave' })).toBeInTheDocument(),
    );
    expect(within(guest).queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument();
  });

  it('leaves exactly one host', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { room, host } = await table();

    await openPanel(user, host);
    await user.click(within(host).getByRole('button', { name: 'Put Grace in charge of the room' }));

    await waitFor(() => {
      const hosts = Object.values(room.state().members).filter((m) => m.role === 'host');
      expect(hosts).toHaveLength(1);
      expect(hosts[0]?.name).toBe('Grace');
    });
  });

  it('keeps the game exactly as it was', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { room, host } = await table();
    const before = room.state().snapshot;
    const rev = room.state().rev;

    await openPanel(user, host);
    await user.click(within(host).getByRole('button', { name: 'Put Grace in charge of the room' }));

    await waitFor(() =>
      expect(within(host).getByRole('button', { name: 'Leave' })).toBeInTheDocument(),
    );
    expect(room.state().snapshot).toEqual(before);
    // Handing over is room business, not a move in the game.
    expect(room.state().rev).toBe(rev);
  });
});
