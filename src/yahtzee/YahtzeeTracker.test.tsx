import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { YahtzeeTracker } from './YahtzeeTracker';
import { boardColumns, boardTotals } from '../rooms/testClient';
import { CATEGORIES, DICE, FACES, isUpper, LABELS } from '@shared/games/yahtzee/rules';
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

/** Five dice adding to a total, for the box that is entered die by die. */
function diceFor(total: number): number[] {
  let left = total - DICE;
  return Array.from({ length: DICE }, () => {
    const add = Math.min(left, FACES - 1);
    left -= add;
    return 1 + add;
  });
}

/** Tap five dice in on an open pad. The fifth is what writes the total. */
async function tapDice(user: User, total: number) {
  let running = 0;
  for (const [at, die] of diceFor(total).entries()) {
    running += die;
    await user.click(
      screen.getByRole('button', {
        name: at === DICE - 1 ? `Die showing ${die}, scores ${running}` : `Die showing ${die}`,
      }),
    );
  }
}

/** Tap the box on the sheet, then the answer on the pad. Two taps, as played. */
async function fill(user: User, name: string, category: Category, value: number) {
  await user.click(screen.getByRole('button', { name: `Score ${LABELS[category]} for ${name}` }));
  if (value === 0) {
    await user.click(screen.getByRole('button', { name: 'Scratch this box' }));
  } else if (category === 'chance') {
    await tapDice(user, value);
  } else if (isUpper(category)) {
    // The key is tapped for how many dice showed the face; it carries the total.
    await user.click(screen.getByRole('button', { name: new RegExp(`total ${value}$`) }));
  } else {
    await user.click(screen.getByRole('button', { name: `Score ${value}` }));
  }
}

/** The keys of one pad, by accessible name, in the order they are offered. */
const padKeys = (name: string) =>
  within(screen.getByRole('group', { name }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));

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
  it('asks an upper box how many of its number you got, not what they come to', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Fives for Ada' }));

    expect(screen.getByText('How many fives did you get?')).toBeInTheDocument();
    expect(padKeys('How many fives')).toEqual([
      '1 five, total 5',
      '2 fives, total 10',
      '3 fives, total 15',
      '4 fives, total 20',
      '5 fives, total 25',
    ]);
  });

  it('writes what the count comes to, not the count', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Sixes for Ada' }));
    await user.click(screen.getByRole('button', { name: '4 sixes, total 24' }));

    expect(filledBoxFor('Ada', 'sixes', 24)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:24']);
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
    expect(screen.queryByRole('group', { name: 'How many fives' })).not.toBeInTheDocument();
  });

  it('lets the pad be closed without scoring anything', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Fives for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group', { name: 'How many fives' })).not.toBeInTheDocument();
    expect(boxFor('Ada', 'fives')).toBeInTheDocument();
  });
});

/**
 * Four fives cannot come to 7, but a pad of totals cannot say so: taken on its
 * own, every total from 5 to 30 is some four of a kind. So these two boxes ask
 * which number was hit first, which is also how it is said at the table.
 */
describe('the boxes that ask for dice', () => {
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
      'Die showing 1, scores 21',
      'Die showing 2, scores 22',
      'Die showing 3, scores 23',
      'Die showing 4, scores 24',
      'Die showing 5, scores 25',
      'Die showing 6, scores 26',
    ]);
    expect(screen.getByRole('button', { name: 'Die showing 3, scores 23' })).toHaveTextContent(
      '23',
    );
  });

  it('will not take a total that number could never make', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));

    // 7 is a perfectly good four of a kind, on ones. It is not one on fives.
    expect(screen.queryByRole('button', { name: /scores 7$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Die showing 2, scores 22' })).toBeInTheDocument();
  });

  it('writes the total the two answers come to', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));
    await user.click(screen.getByRole('button', { name: 'Die showing 3, scores 23' }));

    expect(filledBoxFor('Ada', 'fourOfAKind', 23)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:23']);
  });

  it('asks three of a kind for the other two dice one at a time', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Three of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Three of a kind on 4' }));

    expect(screen.getByText('Three 4s. What were the other two dice?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Die showing 6' }));
    expect(screen.getByText('One more die. 18 so far.')).toBeInTheDocument();

    // The matched dice hold the first three places, so this is the fourth.
    expect(
      screen.getByRole('button', { name: 'Take back the fourth die, showing 6' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Die showing 1, scores 19' }));
    expect(totals(container)).toEqual(['Ada:19']);
  });

  // Stepping replaces every key, which would otherwise drop a keyboard on the
  // body with nothing selected.
  it('puts the caret on the new keys when the step changes', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Four of a kind for Ada' }));
    await user.click(screen.getByRole('button', { name: 'Four of a kind on 5' }));
    expect(screen.getByRole('button', { name: 'Die showing 1, scores 21' })).toHaveFocus();

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
    await user.click(screen.getByRole('button', { name: 'Die showing 3, scores 23' }));

    await user.click(screen.getByRole('button', { name: 'Change Four of a kind for Ada, now 23' }));
    expect(screen.getByText('Which number did you get four of?')).toBeInTheDocument();
  });

  it('asks chance for the five dice, and adds them up itself', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Chance for Ada' }));

    expect(screen.getByRole('group', { name: 'The first die' })).toBeInTheDocument();
    expect(screen.getByText('Tap each of your five dice.')).toBeInTheDocument();

    for (const die of [6, 4, 4, 3]) {
      await user.click(screen.getByRole('button', { name: `Die showing ${die}` }));
    }
    expect(screen.getByRole('group', { name: 'The fifth die' })).toBeInTheDocument();
    expect(screen.getByText('One more die. 17 so far.')).toBeInTheDocument();

    // The last key says what it writes, so the total is on screen before it is taken.
    await user.click(screen.getByRole('button', { name: 'Die showing 2, scores 19' }));
    expect(filledBoxFor('Ada', 'chance', 19)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:19']);
  });

  it('takes a misread die back where it sits, rather than starting the hand over', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await user.click(screen.getByRole('button', { name: 'Score Chance for Ada' }));

    await user.click(screen.getByRole('button', { name: 'Die showing 6' }));
    await user.click(screen.getByRole('button', { name: 'Die showing 2' }));
    expect(screen.getByText('Three more dice. 8 so far.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Take back the first die, showing 6' }));
    expect(screen.getByText('Four more dice. 2 so far.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'The second die' })).toBeInTheDocument();
  });

  it('still scratches chance in two taps, without counting any dice out', async () => {
    const { user, container } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'chance', 0);

    expect(filledBoxFor('Ada', 'chance', 0)).toBeInTheDocument();
    expect(totals(container)).toEqual(['Ada:0']);
  });

  it('starts the chance hand again when a filled box is reopened', async () => {
    const { user } = setup();
    await addPlayers(user, 'Ada');
    await fill(user, 'Ada', 'chance', 19);

    await user.click(screen.getByRole('button', { name: 'Change Chance for Ada, now 19' }));
    expect(screen.getByText('Tap each of your five dice.')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: '2 fours, total 8' }));
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
    await tapDice(user, 12);
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
  /** Scratches every box still open, so the end of the game can be reached. */
  async function fillSheet(user: User, name: string) {
    for (const category of CATEGORIES) {
      const box = boxFor(name, category);
      if (!box) continue;
      await user.click(box);
      await user.click(screen.getByRole('button', { name: 'Scratch this box' }));
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
    await fill(user, 'Ada', 'chance', 19);
    await fillSheet(user, 'Ada');
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
