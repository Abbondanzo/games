import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ScrabbleTracker } from './ScrabbleTracker';
import { clearDictionaryCache, retryConfig } from './lib/dictionary';

const Router = ({ children }: { children: ReactNode }) => (
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    {children}
  </MemoryRouter>
);

function setup() {
  const user = userEvent.setup();
  render(<Router><ScrabbleTracker /></Router>);
  return user;
}

const wordBox = () => screen.getByLabelText('Word played');
const total = () => Number(screen.getByTestId('turn-total').textContent);
const tiles = () => within(screen.getByRole('group', { name: 'Letters played' })).getAllByRole('button');
const board = () =>
  screen.getAllByRole('listitem')
    .filter((li) => li.querySelector('.pts'))
    .map((li) => `${li.querySelector('.name')?.textContent}:${li.querySelector('.pts')?.textContent}`);

async function addPlayers(user: ReturnType<typeof userEvent.setup>, names: string) {
  await user.type(screen.getByLabelText('Player name'), names);
  await user.click(screen.getByRole('button', { name: 'Add' }));
}

const dictResponse = (word: string) => ({
  ok: true,
  status: 200,
  json: async () => [{
    word,
    phonetic: '/test/',
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `a definition of ${word}` }] }],
  }],
});

const bar = () => screen.getByRole('status');
const originalDelay = retryConfig.delayMs;

beforeEach(() => {
  clearDictionaryCache();
  vi.unstubAllGlobals();
  retryConfig.delayMs = 0; // don't wait out the 502 retry backoff in tests
});

afterEach(() => {
  retryConfig.delayMs = originalDelay;
});

describe('entering a turn', () => {
  it('scores a plain word and moves to the next player', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');

    await user.type(wordBox(), 'quiz');
    expect(wordBox()).toHaveValue('QUIZ');
    expect(total()).toBe(22);

    await user.click(screen.getByRole('button', { name: 'Score turn' }));

    expect(board()).toEqual(['Ada:22', 'Grace:0']);
    expect(screen.getByText('Grace', { selector: 'b' })).toBeInTheDocument();
    expect(total()).toBe(0);
    expect(wordBox()).toHaveValue('');
  });

  it('submits on Enter', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'cat{Enter}');
    expect(board()).toEqual(['Ada:5']);
  });

  it('cycles a tile through the bonus squares by clicking', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'quiz');

    await user.click(tiles()[0]!);
    expect(total()).toBe(32); // double letter on Q
    await user.click(tiles()[0]!);
    expect(total()).toBe(42); // triple letter
    await user.click(tiles()[0]!);
    expect(total()).toBe(12); // blank
    await user.click(tiles()[0]!);
    expect(total()).toBe(22); // back to plain
  });

  it('supports keyboard shortcuts on a focused tile', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'quiz');

    tiles()[0]!.focus();
    await user.keyboard('3');
    expect(total()).toBe(42);
    await user.keyboard('b');
    expect(total()).toBe(12);
    await user.keyboard('1');
    expect(total()).toBe(22);
  });

  it('will not score a bingo on its own with no word', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Score turn' }));

    expect(board()).toEqual(['Ada:0', 'Grace:0']);
    expect(screen.getByText(/Now playing/)).toHaveTextContent('Ada');
  });

  it('applies the word multiplier and the bingo bonus', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'quiz');
    await user.click(screen.getByRole('button', { name: '×3' }));
    expect(total()).toBe(66);
    await user.click(screen.getByRole('checkbox'));
    expect(total()).toBe(116);
  });

  it('keeps a tile bonus when more letters are typed', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'quiz');
    await user.click(tiles()[0]!); // Q on a double letter
    await user.type(wordBox(), 'z');
    expect(total()).toBe(10 * 2 + 1 + 1 + 10 + 10);
  });

  it('banks several words into one turn', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'quiz');
    await user.click(screen.getByRole('button', { name: 'Another word' }));
    expect(wordBox()).toHaveValue('');

    await user.type(wordBox(), 'cat');
    expect(total()).toBe(27);
    await user.click(screen.getByRole('button', { name: 'Score turn' }));
    expect(board()).toEqual(['Ada:27']);
    expect(screen.getByText('QUIZ + CAT')).toBeInTheDocument();
  });
});

describe('game management', () => {
  it('passes, undoes, and adjusts scores', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');

    await user.click(screen.getByRole('button', { name: 'Pass' }));
    expect(screen.getByText('passed')).toBeInTheDocument();

    await user.type(wordBox(), 'zebra{Enter}');
    expect(board()).toEqual(['Grace:16', 'Ada:0']);

    await user.click(screen.getByRole('button', { name: 'Undo last' }));
    expect(board()).toEqual(['Ada:0', 'Grace:0']);

    await user.type(screen.getByLabelText('Adjustment points'), '-8');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(board()).toEqual(['Grace:0', 'Ada:-8']);
  });

  it('hands the turn over when a player is clicked on the scoreboard', async () => {
    const user = setup();
    await addPlayers(user, 'Ada, Grace');
    await user.click(screen.getByTitle("Make it Grace's turn"));
    expect(screen.getByText('Grace', { selector: 'b' })).toBeInTheDocument();
  });

  it('keeps players but clears scores on a new game', async () => {
    const user = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await user.type(wordBox(), 'cat{Enter}');
    await user.click(screen.getByRole('button', { name: 'New game' }));
    expect(board()).toEqual(['Ada:0', 'Grace:0']);
  });

  it('clears players as well as scores on reset all', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await user.type(wordBox(), 'cat{Enter}');

    await user.click(screen.getByRole('button', { name: 'Reset all' }));

    expect(board()).toEqual([]);
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Player name')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('keeps everything if reset all is declined', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await addPlayers(user, 'Ada, Grace');
    await user.type(wordBox(), 'cat{Enter}');

    await user.click(screen.getByRole('button', { name: 'Reset all' }));

    expect(confirm).toHaveBeenCalled();
    expect(board()).toEqual(['Ada:5', 'Grace:0']);
    confirm.mockRestore();
  });

  it('does not bring the old players back after a reload', async () => {
    const user = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await addPlayers(user, 'Ada, Grace');
    await user.type(wordBox(), 'cat{Enter}');
    await user.click(screen.getByRole('button', { name: 'Reset all' }));

    cleanup();
    render(<Router><ScrabbleTracker /></Router>);
    expect(board()).toEqual([]);
    confirm.mockRestore();
  });

  it('restores an in-progress game from localStorage', async () => {
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'cat{Enter}');

    expect(localStorage.getItem('board-games.scrabble.v1')).toContain('Ada');

    cleanup();
    render(<Router><ScrabbleTracker /></Router>);
    expect(board()).toEqual(['Ada:5']);
  });
});

describe('a stored game that is malformed', () => {
  const seed = (value: unknown) =>
    localStorage.setItem('board-games.scrabble.v1', JSON.stringify(value));

  it('recovers from a current player index that is out of range', () => {
    seed({
      players: [{ id: 'a', name: 'Ada' }, { id: 'g', name: 'Grace' }],
      turns: [],
      currentIndex: 5,
    });
    render(<Router><ScrabbleTracker /></Router>);
    expect(screen.getByText(/Now playing/)).toHaveTextContent('Ada');
    expect(screen.getByRole('button', { name: 'Score turn' })).toBeEnabled();
  });

  it('drops turns that are the wrong shape rather than showing NaN', () => {
    seed({
      players: [{ id: 'a', name: 'Ada' }],
      turns: [{ id: 't', playerId: 'a', kind: 'play', words: ['X'], bingo: false, points: 'lots' }],
      currentIndex: 0,
    });
    render(<Router><ScrabbleTracker /></Router>);
    expect(board()).toEqual(['Ada:0']);
  });

  it('starts clean when the players themselves are malformed', () => {
    seed({ players: ['Ada'], turns: [], currentIndex: 0 });
    expect(() => render(<Router><ScrabbleTracker /></Router>)).not.toThrow();
    expect(board()).toEqual([]);
  });
});

describe('dictionary', () => {
  it('confirms a valid word inline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => dictResponse('hello')));
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'hello');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() => expect(bar()).toHaveClass('validity', 'valid'));
    expect(bar()).toHaveTextContent('HELLO is a valid word');
  });

  it('reports a word that is not in the dictionary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'zzzz');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() => expect(bar()).toHaveClass('validity', 'invalid'));
    expect(bar()).toHaveTextContent('ZZZZ is not in the dictionary');
  });

  // Regression: a failed fetch used to surface the raw "Failed to fetch".
  it('explains a network failure instead of showing the raw error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'hello');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() => expect(bar()).toHaveClass('validity', 'error'));
    expect(bar()).toHaveTextContent(/Check your internet connection/);
    expect(bar()).not.toHaveClass('invalid');
    expect(screen.queryByText(/^Failed to fetch$/)).not.toBeInTheDocument();
  });

  // Regression: the drawer used the `hidden` attribute, which `display: flex`
  // overrode, so it was stuck open. It is now conditionally rendered.
  it('opens the drawer prefilled and removes it from the DOM on close', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => dictResponse('quiz')));
    const user = setup();
    await addPlayers(user, 'Ada');
    await user.type(wordBox(), 'quiz');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Dictionary' })[0]!);

    const dialog = await screen.findByRole('dialog', { name: 'Dictionary' });
    expect(within(dialog).getByLabelText('Word to look up')).toHaveValue('QUIZ');
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveClass('valid'));
    expect(within(dialog).getByRole('listitem')).toHaveTextContent('a definition of quiz');

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  describe('verdict bar in the modal', () => {
    const openDrawer = async (user: ReturnType<typeof userEvent.setup>, word: string) => {
      await addPlayers(user, 'Ada');
      await user.type(wordBox(), word);
      await user.click(screen.getAllByRole('button', { name: 'Dictionary' })[0]!);
      const dialog = await screen.findByRole('dialog');
      return () => within(dialog).getByRole('status');
    };

    it('shows a green bar for a valid word', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => dictResponse('quiz')));
      const user = setup();
      const verdict = await openDrawer(user, 'quiz');

      await waitFor(() => expect(verdict()).toHaveClass('validity', 'valid'));
      expect(verdict()).toHaveTextContent('QUIZ is a valid word');
    });

    it('shows a red bar for a word the dictionary does not have', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
      const user = setup();
      const verdict = await openDrawer(user, 'zzzz');

      await waitFor(() => expect(verdict()).toHaveClass('validity', 'invalid'));
      expect(verdict()).toHaveTextContent('ZZZZ is not in the dictionary');
    });

    // Regression: a 502 used to surface as an error where the user read it as
    // "not a word". It is transient and unrelated to validity.
    it('recovers from a 502 and still calls a valid word valid', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValue(dictResponse('ax')));
      const user = setup();
      const verdict = await openDrawer(user, 'ax');

      await waitFor(() => expect(verdict()).toHaveClass('validity', 'valid'));
      expect(verdict()).toHaveTextContent('AX is a valid word');
    });

    it('distinguishes a persistent 502 from an invalid word', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502 })));
      const user = setup();
      const verdict = await openDrawer(user, 'quiz');

      await waitFor(() => expect(verdict()).toHaveClass('validity', 'error'));
      expect(verdict()).toHaveTextContent(/perfectly valid word/);
      expect(verdict()).not.toHaveClass('invalid');
      expect(verdict()).not.toHaveTextContent('not in the dictionary');
    });
  });

  it('closes the drawer on Escape and on a backdrop click', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => dictResponse('cat')));
    const user = setup();
    await addPlayers(user, 'Ada');

    await user.click(screen.getAllByRole('button', { name: 'Dictionary' })[0]!);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Dictionary' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
