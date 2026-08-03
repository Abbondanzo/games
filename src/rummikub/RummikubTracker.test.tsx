import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { RummikubTracker } from './RummikubTracker';

const Router = ({ children }: { children: ReactNode }) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {children}
  </MemoryRouter>
);

type User = ReturnType<typeof userEvent.setup>;

function setup() {
  const user = userEvent.setup();
  render(<Router><RummikubTracker /></Router>);
  return user;
}

async function addPlayers(user: User, names: string) {
  await user.type(screen.getByLabelText('Player name'), names);
  await user.click(screen.getByRole('button', { name: 'Add' }));
}

const board = () =>
  screen.getAllByRole('listitem')
    .filter((li) => li.querySelector('.pts'))
    .map((li) => `${li.querySelector('.name')?.textContent}:${li.querySelector('.pts')?.textContent}`);

const pot = () => screen.getByTestId('round-pot').textContent;

/** Pick the winner, type each loser's rack total, and score the round. */
async function playRound(user: User, winner: string, racks: Record<string, number>) {
  await user.click(screen.getByRole('button', { name: winner, pressed: false }));
  for (const [name, value] of Object.entries(racks)) {
    await user.clear(screen.getByLabelText(`Tiles left for ${name}`));
    await user.type(screen.getByLabelText(`Tiles left for ${name}`), String(value));
  }
  await user.click(screen.getByRole('button', { name: 'Score round' }));
}

describe('setup', () => {
  it('asks for two players before a round can be scored', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    expect(screen.getByText('Add at least two players to score a round.')).toBeInTheDocument();
  });

  it('asks who went out before showing the racks', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    expect(screen.getByText('Who went out?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tiles left for Grace')).not.toBeInTheDocument();
  });
});

describe('scoring a round', () => {
  it('pays the winner the sum of the other racks', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await playRound(user, 'Ada', { Grace: 24, Alan: 41 });

    expect(board()).toEqual(['Ada:65', 'Grace:-24', 'Alan:-41']);
  });

  it('previews the winner’s score while the racks are entered', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));
    expect(pot()).toBe('+0');

    await user.type(screen.getByLabelText('Tiles left for Grace'), '24');
    expect(pot()).toBe('+24');
    await user.type(screen.getByLabelText('Tiles left for Alan'), '41');
    expect(pot()).toBe('+65');
  });

  it('does not offer a rack for the player who went out', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));
    expect(screen.queryByLabelText('Tiles left for Ada')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tiles left for Grace')).toBeInTheDocument();
  });

  it('accumulates across rounds and nets to zero', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await playRound(user, 'Ada', { Grace: 24, Alan: 41 });
    await playRound(user, 'Alan', { Ada: 30, Grace: 12 });

    expect(board().sort()).toEqual(['Ada:35', 'Alan:1', 'Grace:-36'].sort());
    const total = board().reduce((sum, row) => sum + Number(row.split(':')[1]), 0);
    expect(total).toBe(0);
  });

  it('handles a round where nobody was left holding tiles', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playRound(user, 'Ada', {});
    expect(board()).toEqual(['Ada:0', 'Grace:0']);
  });

  it('clears the entry form ready for the next round', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playRound(user, 'Ada', { Grace: 10 });

    expect(screen.getByRole('heading', { name: /Round/ })).toHaveTextContent('#2');
    expect(screen.queryByLabelText('Tiles left for Grace')).not.toBeInTheDocument();
  });
});

describe('the tile pad', () => {
  const pad = () => screen.getByRole('group', { name: 'Tile values' });

  it('tallies tapped tiles onto the focused player', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));

    // Grace is focused by default as the first player still holding tiles.
    await user.click(within(pad()).getByRole('button', { name: '13' }));
    await user.click(within(pad()).getByRole('button', { name: '7' }));
    expect(screen.getByLabelText('Tiles left for Grace')).toHaveValue(20);
    expect(pot()).toBe('+20');
  });

  it('counts a joker as 30', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));
    await user.click(within(pad()).getByRole('button', { name: 'Joker' }));
    expect(screen.getByLabelText('Tiles left for Grace')).toHaveValue(30);
  });

  it('removes the last tile tapped', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));
    await user.click(within(pad()).getByRole('button', { name: '9' }));
    await user.click(within(pad()).getByRole('button', { name: 'Joker' }));
    expect(screen.getByLabelText('Tiles left for Grace')).toHaveValue(39);

    await user.click(screen.getByRole('button', { name: 'Remove last tile' }));
    expect(screen.getByLabelText('Tiles left for Grace')).toHaveValue(9);
  });

  it('applies taps to whichever player is selected', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));

    await user.click(screen.getByRole('button', { name: 'Enter tiles for Alan' }));
    await user.click(within(pad()).getByRole('button', { name: '11' }));

    expect(screen.getByLabelText('Tiles left for Alan')).toHaveValue(11);
    expect(screen.getByLabelText('Tiles left for Grace')).toHaveValue(null);
  });

  it('lets a typed total replace the tally', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Ada', pressed: false }));
    await user.click(within(pad()).getByRole('button', { name: '5' }));

    const input = screen.getByLabelText('Tiles left for Grace');
    await user.clear(input);
    await user.type(input, '42');
    expect(input).toHaveValue(42);
    expect(pot()).toBe('+42');
  });
});

describe('history and undo', () => {
  it('lists each round with the per-player swing', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playRound(user, 'Ada', { Grace: 15 });

    expect(screen.getByText('Ada out')).toBeInTheDocument();
    expect(screen.getByText(/Ada \+15\s+Grace -15/)).toBeInTheDocument();
  });

  it('undoes the last round', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playRound(user, 'Ada', { Grace: 15 });
    await user.click(screen.getByRole('button', { name: 'Undo last' }));

    expect(board()).toEqual(['Ada:0', 'Grace:0']);
    expect(screen.getByText('No rounds played yet.')).toBeInTheDocument();
  });
});

describe('removing a player', () => {
  it('rescores rounds they only lost', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace, Alan');
    await playRound(user, 'Ada', { Grace: 24, Alan: 41 });

    await user.click(screen.getByRole('button', { name: 'Remove Alan' }));

    // Ada's pot drops to just Grace's rack.
    expect(board()).toEqual(['Ada:24', 'Grace:-24']);
    confirm.mockRestore();
  });

  it('warns that rounds they won will go', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await addPlayers(user, 'Ada, Grace');
    await playRound(user, 'Ada', { Grace: 24 });

    await user.click(screen.getByRole('button', { name: 'Remove Ada' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 round they won'));
    expect(board()).toEqual(['Ada:24', 'Grace:-24']); // declined
    confirm.mockRestore();
  });

  it('does not ask before any round has been played', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Remove Grace' }));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe('persistence', () => {
  it('restores a game in progress', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playRound(user, 'Ada', { Grace: 24 });

    cleanup();
    render(<Router><RummikubTracker /></Router>);
    expect(board()).toEqual(['Ada:24', 'Grace:-24']);
  });

  it('starts clean when the stored game is malformed', () => {
    localStorage.setItem('games.rummikub.v1', JSON.stringify({ players: [null], rounds: [] }));
    expect(() => render(<Router><RummikubTracker /></Router>)).not.toThrow();
    expect(board()).toEqual([]);
  });

  it('drops a stored round whose winner is gone', () => {
    localStorage.setItem('games.rummikub.v1', JSON.stringify({
      players: [{ id: 'a', name: 'Ada' }],
      rounds: [{ id: 'r', winnerId: 'ghost', penalties: { a: 10 } }],
    }));
    render(<Router><RummikubTracker /></Router>);
    expect(screen.getByText('No rounds played yet.')).toBeInTheDocument();
  });
});
