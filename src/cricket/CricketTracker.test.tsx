import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CricketTracker } from './CricketTracker';

const Router = ({ children }: { children: ReactNode }) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {children}
  </MemoryRouter>
);

type User = ReturnType<typeof userEvent.setup>;
type Ring = 'Single' | 'Double' | 'Triple';
/** A dart as the UI names it: the ring, then the target button's label. */
type Throw = [Ring, string];

function setup() {
  const user = userEvent.setup();
  render(<Router><CricketTracker /></Router>);
  return user;
}

async function addPlayers(user: User, names: string) {
  await user.type(screen.getByLabelText('Player name'), names);
  await user.click(screen.getByRole('button', { name: 'Add' }));
}

const boardTable = () => screen.getByRole('table');
const rowFor = (label: string) =>
  within(boardTable()).getAllByRole('row')
    .find((r) => r.querySelector('th')?.textContent?.startsWith(label))!;

/** What the scoreboard says for a player on a target row. */
const marksOn = (target: string, column: number) =>
  within(rowFor(target)).getAllByRole('cell')[column]?.textContent ?? '';

const pointsFor = (column: number) =>
  within(rowFor('Points')).getAllByRole('cell')[column]?.textContent ?? '';

const whoseTurn = () => screen.getByText(/Now throwing/).textContent ?? '';

async function dart(user: User, [ring, target]: Throw) {
  await user.click(screen.getByRole('button', { name: ring }));
  await user.click(screen.getByRole('button', { name: target }));
}

/** Throw darts and close out the turn, which three darts do on their own. */
async function playTurn(user: User, ...throws: Throw[]) {
  for (const t of throws) await dart(user, t);
  if (throws.length < 3 && !screen.getByRole('button', { name: 'End turn' }).hasAttribute('disabled')) {
    await user.click(screen.getByRole('button', { name: 'End turn' }));
  }
}

const missTurn = (user: User) => playTurn(user, ['Single', 'Miss'], ['Single', 'Miss'], ['Single', 'Miss']);

/**
 * The win banner. The turn header is also a live region, so that whoever is
 * throwing is told when it becomes their turn.
 */
const banner = () => screen.queryAllByRole('status').find((el) => el.classList.contains('banner'));

describe('setup', () => {
  it('shows the seven targets and a points row', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    for (const t of ['20', '19', '18', '17', '16', '15', 'Bull']) {
      expect(rowFor(t)).toBeInTheDocument();
    }
    expect(rowFor('Points')).toBeInTheDocument();
  });

  it('starts with the first player throwing', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    expect(whoseTurn()).toContain('Ada');
  });
});

describe('marks', () => {
  it('closes a target with three singles and passes the turn on', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Single', 'Single 20'], ['Single', 'Single 20'], ['Single', 'Single 20']);

    expect(marksOn('20', 0)).toContain('closed');
    expect(whoseTurn()).toContain('Grace');
  });

  it('counts a triple as three marks from one dart', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);
    expect(marksOn('20', 0)).toContain('closed');
  });

  it('counts a double as two marks', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Double', 'Double 19']);
    expect(marksOn('19', 0)).toContain('two marks');
  });

  it('shows a mark the moment a dart is entered, before the turn ends', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await dart(user, ['Triple', 'Triple 18']);
    expect(marksOn('18', 0)).toContain('closed');
    expect(whoseTurn()).toContain('Ada'); // still mid-turn
  });

  it('treats a triple on the bull as the inner bull, worth two marks', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Double Bull']);
    expect(marksOn('Bull', 0)).toContain('two marks');
  });

  it('records a miss without marks and still spends a dart', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await missTurn(user);

    expect(whoseTurn()).toContain('Grace');
    expect(marksOn('20', 0)).toContain('no marks');
  });
});

describe('points', () => {
  it('scores nothing until the target is closed', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);
    expect(pointsFor(0)).toBe('0');
  });

  it('scores a triple once the target is closed', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']); // Ada closes
    await missTurn(user);                          // Grace
    await playTurn(user, ['Triple', 'Triple 20']); // Ada scores 60

    expect(pointsFor(0)).toBe('60');
  });

  it('scores only the marks beyond closing', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    // Two singles then a triple: one mark closes, the other two score.
    await playTurn(user, ['Single', 'Single 20'], ['Single', 'Single 20'], ['Triple', 'Triple 20']);
    expect(pointsFor(0)).toBe('40');
  });

  it('stops paying once every opponent has closed the target', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']); // Ada closes
    await playTurn(user, ['Triple', 'Triple 20']); // Grace closes - 20 is dead

    expect(rowFor('20')).toHaveTextContent('dead');

    await playTurn(user, ['Triple', 'Triple 20']); // Ada again
    expect(pointsFor(0)).toBe('0');
  });

  it('previews what the throw in progress is worth', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);
    await missTurn(user);

    await dart(user, ['Triple', 'Triple 20']);
    expect(screen.getByTestId('throw-preview')).toHaveTextContent('0 marks · 60 pts');
  });
});

describe('correcting a throw', () => {
  it('removes a single dart from the throw', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await dart(user, ['Single', 'Single 20']);
    await user.click(screen.getByRole('button', { name: /Remove dart 1, S20/ }));

    expect(screen.queryByRole('button', { name: /Remove dart 1/ })).not.toBeInTheDocument();
    expect(marksOn('20', 0)).toContain('no marks');
  });

  it('clears a throw in progress before touching history', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await dart(user, ['Single', 'Single 20']);
    await user.click(screen.getByRole('button', { name: 'Undo turn' }));

    expect(marksOn('20', 0)).toContain('no marks');
    expect(whoseTurn()).toContain('Ada');
  });

  it('rolls back a completed turn', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);
    expect(whoseTurn()).toContain('Grace');

    await user.click(screen.getByRole('button', { name: 'Undo turn' }));
    expect(marksOn('20', 0)).toContain('no marks');
    expect(whoseTurn()).toContain('Ada');
  });

  it('hands the turn to another player when their column is clicked', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByTitle("Make it Grace's turn"));
    expect(whoseTurn()).toContain('Grace');
  });

  // The darts belong to whoever was up when they landed, so they must not
  // follow the seat when the turn is handed over.
  it('banks a throw in progress with the thrower before handing over', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await dart(user, ['Single', 'Single 20']);
    await dart(user, ['Single', 'Single 20']);
    expect(marksOn('20', 0)).toContain('two marks');

    await user.click(screen.getByTitle("Make it Grace's turn"));

    expect(marksOn('20', 0)).toContain('two marks'); // still Ada's
    expect(marksOn('20', 1)).toContain('no marks');
    expect(whoseTurn()).toContain('Grace');
    expect(screen.queryByRole('button', { name: /Remove dart 1/ })).not.toBeInTheDocument();
  });
});

describe('a stored game that is malformed', () => {
  const seed = (value: unknown) =>
    localStorage.setItem('games.cricket.v1', JSON.stringify(value));

  it('recovers from a turn with no darts instead of crashing on every load', () => {
    seed({
      players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }],
      turns: [{ id: 't', playerId: 'a' }],
      currentIndex: 0,
    });
    expect(() => render(<Router><CricketTracker /></Router>)).not.toThrow();
    expect(screen.getByText(/Now throwing/)).toHaveTextContent('Ada');
  });

  it('recovers from a current player index that is out of range', () => {
    seed({
      players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }, { id: 'g', name: 'Grace', joinedAtTurn: 0 }],
      turns: [],
      currentIndex: 9,
    });
    render(<Router><CricketTracker /></Router>);
    expect(screen.getByText(/Now throwing/)).toHaveTextContent('Ada');
    expect(screen.getByRole('button', { name: 'Miss' })).toBeEnabled();
  });

  it('drops turns belonging to players who are no longer listed', () => {
    seed({
      players: [{ id: 'a', name: 'Ada', joinedAtTurn: 0 }],
      turns: [{ id: 't', playerId: 'ghost', darts: [{ target: 20, multiplier: 3 }] }],
      currentIndex: 0,
    });
    render(<Router><CricketTracker /></Router>);
    expect(screen.getByText('No darts thrown yet.')).toBeInTheDocument();
  });

  it('starts clean when the players themselves are malformed', () => {
    seed({ players: [null], turns: [], currentIndex: 0 });
    expect(() => render(<Router><CricketTracker /></Router>)).not.toThrow();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

/** Ada closes every target; Grace throws misses in between. */
async function adaClosesOut(user: User) {
  for (const t of ['20', '19', '18', '17', '16', '15']) {
    await playTurn(user, ['Triple', `Triple ${t}`]);
    await missTurn(user);
  }
  // The inner bull is only two marks, so one more dart closes it.
  await playTurn(user, ['Triple', 'Double Bull'], ['Single', 'Single Bull']);
}

describe('winning', () => {
  it('announces the winner and locks the board', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await adaClosesOut(user);

    expect(banner()).toHaveTextContent('Ada wins');
    // Entry is locked: no more darts can be thrown.
    expect(screen.getByRole('button', { name: 'Miss' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Triple' })).toBeDisabled();
  });

  it('keeps the win after a reload', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await adaClosesOut(user);

    cleanup();
    render(<Router><CricketTracker /></Router>);
    expect(banner()).toHaveTextContent('Ada wins');
  });

  it('withholds the win from a player who closes out while behind', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');

    // Grace banks 60 on 20 first.
    await missTurn(user);
    await playTurn(user, ['Triple', 'Triple 20']);
    await missTurn(user);
    await playTurn(user, ['Triple', 'Triple 20']);

    // Ada now closes everything but has no points.
    for (const t of ['20', '19', '18', '17', '16', '15']) {
      await playTurn(user, ['Triple', `Triple ${t}`]);
      await missTurn(user);
    }
    await playTurn(user, ['Triple', 'Double Bull'], ['Single', 'Single Bull']);

    expect(banner()).toBeUndefined();
    expect(pointsFor(0)).toBe('0');
    expect(pointsFor(1)).toBe('60');
  });
});

describe('cut-throat', () => {
  it('deals points to opponents instead of the thrower', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Cut-throat' }));

    await playTurn(user, ['Triple', 'Triple 20']); // Ada closes
    await missTurn(user);
    await playTurn(user, ['Triple', 'Triple 20']); // 60 dealt to Grace

    expect(pointsFor(0)).toBe('0');
    expect(pointsFor(1)).toBe('60');
    expect(rowFor('Points')).toHaveTextContent('low wins');
  });

  // Every dart is catalogued and points are derived, so switching mode rescores
  // the same throws rather than starting over.
  it('rescores the existing game instead of restarting it', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm');
    await addPlayers(user, 'Ada, Grace');

    await playTurn(user, ['Triple', 'Triple 20']); // Ada closes 20
    await missTurn(user);
    await playTurn(user, ['Triple', 'Triple 20']); // Ada scores 60 in standard
    expect(pointsFor(0)).toBe('60');
    expect(pointsFor(1)).toBe('0');

    await user.click(screen.getByRole('button', { name: 'Cut-throat' }));

    // Same darts, reinterpreted: the 60 now sits against Grace.
    expect(confirm).not.toHaveBeenCalled();
    expect(marksOn('20', 0)).toContain('closed');
    expect(pointsFor(0)).toBe('0');
    expect(pointsFor(1)).toBe('60');
    confirm.mockRestore();
  });

  it('returns to the original scores when switched back', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);
    await missTurn(user);
    await playTurn(user, ['Triple', 'Triple 20']);

    await user.click(screen.getByRole('button', { name: 'No points' }));
    expect(within(rowFor('Marks')).getAllByRole('cell')[0]).toHaveTextContent('3');

    await user.click(screen.getByRole('button', { name: 'Standard' }));
    expect(pointsFor(0)).toBe('60');
  });

  it('keeps the turn order across a mode change', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);
    expect(whoseTurn()).toContain('Grace');

    await user.click(screen.getByRole('button', { name: 'Cut-throat' }));
    expect(whoseTurn()).toContain('Grace');
  });
});

describe('no points mode', () => {
  it('shows a marks total instead of a points row', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'No points' }));

    expect(screen.queryByText('Points')).not.toBeInTheDocument();
    expect(rowFor('Marks')).toBeInTheDocument();
  });

  it('counts marks and never awards points', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'No points' }));

    await playTurn(user, ['Triple', 'Triple 20']); // closes 20
    await missTurn(user);
    await playTurn(user, ['Triple', 'Triple 20']); // would be 60 points elsewhere

    expect(within(rowFor('Marks')).getAllByRole('cell')[0]).toHaveTextContent('3');
  });

  it('is won by the first player to close every target', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'No points' }));
    await adaClosesOut(user);

    expect(banner()).toHaveTextContent('First to close every target');
  });

  it('hides the points figure from the throw preview', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'No points' }));

    await playTurn(user, ['Triple', 'Triple 20']);
    await missTurn(user);
    await dart(user, ['Triple', 'Triple 20']);

    expect(screen.getByTestId('throw-preview')).not.toHaveTextContent('pts');
  });
});

describe('removing a player', () => {
  const removeButton = (name: string) => screen.getByRole('button', { name: `Remove ${name}` });
  const playerNames = () =>
    within(boardTable()).getAllByRole('columnheader').slice(1).map((h) => h.textContent);

  it('removes a player who has thrown nothing without asking', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');

    await user.click(removeButton('Grace'));

    expect(confirm).not.toHaveBeenCalled();
    expect(playerNames()).toEqual(['Ada']);
    confirm.mockRestore();
  });

  it('asks before removing a player who has marks, and keeps them if declined', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Double', 'Double 19']); // Ada: two marks, no points

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(removeButton('Ada'));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2 marks'));
    expect(playerNames()).toEqual(['Ada', 'Grace']);
    expect(marksOn('19', 0)).toContain('two marks');
    confirm.mockRestore();
  });

  it('names the points at stake and removes the player when confirmed', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']); // Ada closes 20
    await missTurn(user);
    await playTurn(user, ['Triple', 'Triple 20']); // Ada scores 60

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(removeButton('Ada'));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('60 points'));
    expect(playerNames()).toEqual(['Grace']);
    confirm.mockRestore();
  });

  it('counts a throw still in progress when deciding to ask', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await dart(user, ['Single', 'Single 17']); // not yet a completed turn

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(removeButton('Ada'));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 mark'));
    confirm.mockRestore();
  });
});

describe('reset all', () => {
  const columns = () =>
    within(boardTable()).getAllByRole('columnheader').slice(1).map((h) => h.textContent);

  it('clears the board and the players', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);

    await user.click(screen.getByRole('button', { name: 'Reset all' }));

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Player name')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('keeps everything if declined', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);

    await user.click(screen.getByRole('button', { name: 'Reset all' }));

    expect(confirm).toHaveBeenCalled();
    expect(columns()).toEqual(['Ada', 'Grace']);
    expect(marksOn('20', 0)).toContain('closed');
    confirm.mockRestore();
  });

  it('keeps the chosen mode so the next game starts the same way', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('button', { name: 'Cut-throat' }));

    await user.click(screen.getByRole('button', { name: 'Reset all' }));

    expect(screen.getByRole('button', { name: 'Cut-throat' })).toHaveAttribute('aria-pressed', 'true');
    confirm.mockRestore();
  });

  it('does not bring the old players back after a reload', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);
    await user.click(screen.getByRole('button', { name: 'Reset all' }));

    cleanup();
    render(<Router><CricketTracker /></Router>);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    confirm.mockRestore();
  });
});

describe('persistence', () => {
  it('restores a game in progress', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await playTurn(user, ['Triple', 'Triple 20']);

    cleanup();
    render(<Router><CricketTracker /></Router>);

    expect(marksOn('20', 0)).toContain('closed');
    expect(whoseTurn()).toContain('Grace');
  });
});
