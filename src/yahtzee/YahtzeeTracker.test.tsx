import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { YahtzeeTracker } from './YahtzeeTracker';
import { boardColumns, boardTotals } from '../rooms/testClient';
import { CATEGORIES, LABELS } from '@shared/games/yahtzee/rules';
import type { Category } from '@shared/games/yahtzee/types';

const Router = ({ children }: { children: ReactNode }) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {children}
  </MemoryRouter>
);

type User = ReturnType<typeof userEvent.setup>;

function setup() {
  const user = userEvent.setup();
  const { container } = render(
    <Router>
      <YahtzeeTracker />
    </Router>,
  );
  return { user, container };
}

async function addPlayers(user: User, names: string) {
  await user.type(screen.getByLabelText('Player name'), names);
  await user.click(screen.getByRole('button', { name: 'Add' }));
}

/** Tap the box on the sheet, then the number on the pad. Two taps, as played. */
async function fill(user: User, name: string, category: Category, value: number) {
  await user.click(screen.getByRole('button', { name: `Score ${LABELS[category]} for ${name}` }));
  await user.click(
    screen.getByRole('button', { name: value === 0 ? 'Scratch this box' : `Score ${value}` }),
  );
}

const totals = (container: HTMLElement) => boardTotals(container);

const boxFor = (name: string, category: Category) =>
  screen.queryByRole('button', { name: `Score ${LABELS[category]} for ${name}` });

const filledBoxFor = (name: string, category: Category, value: number) =>
  screen.queryByRole('button', {
    name: `Change ${LABELS[category]} for ${name}, now ${value}`,
  });

describe('setting up', () => {
  it('says what to do before anybody is playing', () => {
    setup();
    expect(
      screen.getByText('Add the players to start a sheet for each of them.'),
    ).toBeInTheDocument();
  });

  it('gives every player a column of their own', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    expect(boardColumns(container)).toEqual(['Ada', 'Grace', 'Alan']);
  });

  it('lays the whole sheet out, both sections and every box', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    for (const category of CATEGORIES) {
      expect(boxFor('Ada', category)).toBeInTheDocument();
    }
    expect(screen.getByText('Upper section')).toBeInTheDocument();
    expect(screen.getByText('Lower section')).toBeInTheDocument();
  });
});

describe('filling a box in', () => {
  it('offers only the numbers the box could hold', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Fives for Ada' }));

    const pad = screen.getByRole('group', { name: 'Score for Fives' });
    expect(
      within(pad)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['5', '10', '15', '20', '25']);
  });

  it('offers a fixed combination its one number', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Full house for Ada' }));

    const pad = screen.getByRole('group', { name: 'Score for Full house' });
    expect(
      within(pad)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['25']);
  });

  it('writes the score into the sheet in two taps', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'fives', 15);

    expect(filledBoxFor('Ada', 'fives', 15)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:15']);
  });

  /** The commonest entry of the game, and the one easiest to leave out. */
  it('takes a turn that scored nothing in the same two taps', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'yahtzee', 0);

    expect(filledBoxFor('Ada', 'yahtzee', 0)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:0']);
    expect(screen.getByText('scratched')).toBeInTheDocument();
  });

  it('closes the pad once the box is filled', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'fives', 15);
    expect(screen.queryByRole('group', { name: 'Score for Fives' })).not.toBeInTheDocument();
  });

  it('lets the pad be closed without scoring anything', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Fives for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group', { name: 'Score for Fives' })).not.toBeInTheDocument();
    expect(boxFor('Ada', 'fives')).toBeInTheDocument();
  });
});

/**
 * Four fives cannot come to 7, but a pad of totals cannot say so: taken on its
 * own, every total from 5 to 30 is some four of a kind. So these two boxes ask
 * which number was hit first, which is also how it is said at the table.
 */
describe('the boxes that ask for dice', () => {
  /** The keys of one pad, by accessible name, in the order they are offered. */
  const padKeys = (name: string) =>
    within(screen.getByRole('group', { name }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));

  it('asks which number was hit rather than what it adds up to', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));

    expect(screen.getByText('Which number did you get four of?')).toBeInTheDocument();
    expect(padKeys('The number for Four of a kind')).toEqual([
      'Four of a kind on 1',
      'Four of a kind on 2',
      'Four of a kind on 3',
      'Four of a kind on 4',
      'Four of a kind on 5',
      'Four of a kind on 6',
    ]);
    // Each carries what it could come to, so the choice is not made blind.
    expect(screen.getByRole('button', { name: 'Four of a kind on 5' })).toHaveTextContent(
      '21 to 26',
    );
  });

  it('offers only the totals that number can make, and shows each one', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));

    expect(screen.getByText('Four 5s. What was the other die?')).toBeInTheDocument();
    // The odd die is what is tapped; the total it makes is shown beside it.
    expect(padKeys('The other die')).toEqual([
      'Other die 1, total 21',
      'Other die 2, total 22',
      'Other die 3, total 23',
      'Other die 4, total 24',
      'Other die 5, total 25',
      'Other die 6, total 26',
    ]);
    expect(screen.getByRole('button', { name: 'Other die 3, total 23' })).toHaveTextContent('23');
  });

  it('will not take a total that number could never make', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));

    // 7 is a perfectly good four of a kind, on ones. It is not one on fives.
    expect(screen.queryByRole('button', { name: /total 7$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other die 2, total 22' })).toBeInTheDocument();
  });

  it('writes the total the two answers come to', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));
    await user.click(screen.getByRole('button', { name: 'Other die 3, total 23' }));

    expect(filledBoxFor('Ada', 'fourOfAKind', 23)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:23']);
  });

  it('asks three of a kind for the other two dice together', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Three of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Three of a kind on 4' }));

    expect(
      screen.getByText('Three 4s. What did the other two dice add up to?'),
    ).toBeInTheDocument();
    expect(padKeys('The other two dice')).toHaveLength(11);

    await user.click(screen.getByRole('button', { name: 'Other dice 7, total 19' }));
    expect(totals(container)).toEqual(['Ada:19']);
  });

  // Stepping replaces every key, which would otherwise drop a keyboard on the
  // body with nothing selected.
  it('puts the caret on the new keys when the step changes', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));
    expect(screen.getByRole('button', { name: 'Other die 1, total 21' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Change the number' }));
    expect(screen.getByRole('button', { name: 'Four of a kind on 1' })).toHaveFocus();
  });

  it('goes back to the number without scoring anything', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 6' }));
    await user.click(screen.getByRole('button', { name: 'Change the number' }));

    expect(screen.getByText('Which number did you get four of?')).toBeInTheDocument();
    expect(boxFor('Ada', 'fourOfAKind')).toBeInTheDocument();
  });

  it('still scratches in two taps, without picking a number first', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'fourOfAKind', 0);

    expect(filledBoxFor('Ada', 'fourOfAKind', 0)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:0']);
  });

  it('starts again at the number when a filled box is reopened', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));
    await user.click(screen.getByRole('button', { name: 'Other die 3, total 23' }));

    await user.click(screen.getByRole('button', { name: 'Change Four of a kind for Ada, now 23' }));
    expect(screen.getByText('Which number did you get four of?')).toBeInTheDocument();
  });

  it('leaves chance asking for the total, because there is nothing to match', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Chance for Ada' }));
    expect(screen.getByRole('group', { name: 'Score for Chance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Score 7' })).toBeInTheDocument();
  });
});

describe('the host tapping whoever calls out a score', () => {
  it('fills in any player, not just the one whose turn it is', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await fill(user, 'Alan', 'sixes', 24);

    expect(totals(container)).toEqual(['Ada:0', 'Grace:0', 'Alan:24']);
  });

  it('moves play on from whoever was scored', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await fill(user, 'Grace', 'sixes', 24);
    expect(screen.getByText('Round 1 of 13')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Now playing: Alan');
  });

  it('hands the turn over when a column heading is tapped', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada, Grace, Alan');
    await user.click(screen.getByRole('button', { name: "Make it Alan's turn" }));
    expect(screen.getByRole('status')).toHaveTextContent('Now playing: Alan');
  });

  it('counts a round only once everybody has taken it', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada, Grace');
    await fill(user, 'Ada', 'ones', 3);
    expect(screen.getByText('Round 1 of 13')).toBeInTheDocument();

    await fill(user, 'Grace', 'ones', 2);
    expect(screen.getByText('Round 2 of 13')).toBeInTheDocument();
  });
});

describe('the totals down the side', () => {
  it('adds the upper bonus in at the target', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'sixes', 30);
    await fill(user, 'Ada', 'fives', 25);
    await fill(user, 'Ada', 'fours', 4);
    expect(totals(container)).toEqual(['Ada:59']);

    // Four more takes the upper section to 63, which is worth another 35.
    await user.click(screen.getByRole('button', { name: 'Change Fours for Ada, now 4' }));
    await user.click(screen.getByRole('button', { name: 'Score 8' }));
    expect(totals(container)).toEqual(['Ada:98']);
  });

  it('counts down what is still needed for the bonus', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'sixes', 30);
    expect(screen.getByText('33 to go')).toBeInTheDocument();
  });
});

describe('extra Yahtzees', () => {
  it('cannot be claimed until the Yahtzee box is worth 50', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    expect(screen.getByRole('button', { name: 'Add an extra Yahtzee for Ada' })).toBeDisabled();

    await fill(user, 'Ada', 'yahtzee', 0);
    expect(screen.getByRole('button', { name: 'Add an extra Yahtzee for Ada' })).toBeDisabled();
  });

  it('adds 100 apiece once it is', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'yahtzee', 50);

    await user.click(screen.getByRole('button', { name: 'Add an extra Yahtzee for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Add an extra Yahtzee' }));
    expect(totals(container)).toEqual(['Ada:150']);

    await user.click(screen.getByRole('button', { name: 'Change extra Yahtzees for Ada, now 1' }));
    await user.click(screen.getByRole('button', { name: 'Add an extra Yahtzee' }));
    expect(totals(container)).toEqual(['Ada:250']);
  });

  it('takes one back', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'yahtzee', 50);
    await user.click(screen.getByRole('button', { name: 'Add an extra Yahtzee for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Add an extra Yahtzee' }));

    await user.click(screen.getByRole('button', { name: 'Change extra Yahtzees for Ada, now 1' }));
    await user.click(screen.getByRole('button', { name: 'Take back an extra Yahtzee' }));
    expect(totals(container)).toEqual(['Ada:50']);
  });

  /**
   * Regression: the bonus was counted from the claims alone, so correcting the
   * Yahtzee box back to a scratch left the 100s on a sheet that no longer said
   * a Yahtzee had been rolled.
   */
  it('stops paying once the Yahtzee box is scratched', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'yahtzee', 50);
    await user.click(screen.getByRole('button', { name: 'Add an extra Yahtzee for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Add an extra Yahtzee' }));
    expect(totals(container)).toEqual(['Ada:150']);

    await user.click(screen.getByRole('button', { name: 'Change Yahtzee for Ada, now 50' }));
    await user.click(screen.getByRole('button', { name: 'Scratch this box' }));
    expect(totals(container)).toEqual(['Ada:0']);
  });
});

describe('putting a mistake right', () => {
  it('changes a number already written in', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'chance', 24);

    await user.click(screen.getByRole('button', { name: 'Change Chance for Ada, now 24' }));
    await user.click(screen.getByRole('button', { name: 'Score 12' }));
    expect(totals(container)).toEqual(['Ada:12']);
  });

  it('empties a box put in the wrong row', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'fours', 12);
    await fill(user, 'Ada', 'chance', 20);

    await user.click(screen.getByRole('button', { name: 'Change Fours for Ada, now 12' }));
    await user.click(screen.getByRole('button', { name: 'Empty this box' }));

    expect(boxFor('Ada', 'fours')).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:20']);
  });

  it('takes back the last box entered', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada, Grace');
    await fill(user, 'Ada', 'ones', 3);
    await fill(user, 'Grace', 'ones', 2);

    await user.click(screen.getByRole('button', { name: 'Undo last' }));
    expect(totals(container)).toEqual(['Ada:3', 'Grace:0']);
  });

  it('has nothing to undo on an untouched sheet', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    expect(screen.queryByRole('button', { name: 'Undo last' })).not.toBeInTheDocument();
  });
});

describe('finishing', () => {
  /** Fills every box for one player, so the end of the game can be reached. */
  async function fillSheet(user: User, name: string, value = 0) {
    for (const category of CATEGORIES) {
      await user.click(
        screen.getByRole('button', { name: `Score ${LABELS[category]} for ${name}` }),
      );
      const label = value === 0 ? 'Scratch this box' : `Score ${value}`;
      const key = screen.queryByRole('button', { name: label });
      await user.click(key ?? screen.getByRole('button', { name: 'Scratch this box' }));
    }
  }

  it('says nothing until every sheet is full', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada, Grace');
    await fillSheet(user, 'Ada');
    expect(screen.queryByText(/wins/)).not.toBeInTheDocument();
  });

  it('names the winner once they are', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada, Grace');
    await fillSheet(user, 'Ada', 30);
    await fillSheet(user, 'Grace');

    expect(screen.getByText('Ada wins.')).toBeInTheDocument();
  });

  it('names both when they tie', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada, Grace');
    await fillSheet(user, 'Ada');
    await fillSheet(user, 'Grace');

    expect(screen.getByText('Ada and Grace tie.')).toBeInTheDocument();
  });
});

describe('the roster', () => {
  it('warns before deleting a sheet that has boxes in it', async () => {
    const { user, container } = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await addPlayers(user, 'Ada, Grace');
    await fill(user, 'Ada', 'sixes', 24);

    await user.click(screen.getByRole('button', { name: 'Remove Ada' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 box already filled in'));
    expect(boardColumns(container)).toEqual(['Ada', 'Grace']);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Remove Ada' }));
    expect(boardColumns(container)).toEqual(['Grace']);
    confirm.mockRestore();
  });

  it('starts a new game with the players kept', async () => {
    const { user, container } = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await fill(user, 'Ada', 'sixes', 24);

    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(boardColumns(container)).toEqual(['Ada', 'Grace']);
    expect(totals(container)).toEqual(['Ada:0', 'Grace:0']);
    confirm.mockRestore();
  });
});
