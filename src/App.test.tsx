import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

/** Every directory the house rules apply to. */
const SOURCE_DIRS = ['src', 'shared', 'worker'];

const renderAt = (path: string) =>
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );

describe('routing', () => {
  it('lists the games on the home page', () => {
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Games' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Scrabble/ })).toBeInTheDocument();
  });

  it('opens the tracker from the home page', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: /Scrabble/ }));
    expect(screen.getByRole('heading', { name: 'Scrabble' })).toBeInTheDocument();
    expect(screen.getByLabelText('Word played')).toBeInTheDocument();
  });

  it('opens the cricket tracker from the home page', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: /Cricket/ }));
    expect(screen.getByRole('heading', { name: 'Cricket' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Ring' })).toBeInTheDocument();
  });

  it('opens the rummikub tracker from the home page', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: /Rummikub/ }));
    expect(screen.getByRole('heading', { name: 'Rummikub' })).toBeInTheDocument();
    expect(screen.getByLabelText('Player name')).toBeInTheDocument();
  });

  it('opens the yahtzee tracker from the home page', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: /Yahtzee/ }));
    expect(screen.getByRole('heading', { name: 'Yahtzee' })).toBeInTheDocument();
    expect(screen.getByLabelText('Player name')).toBeInTheDocument();
  });

  it('sends an unknown route home', () => {
    renderAt('/not-a-game');
    expect(screen.getByRole('heading', { name: 'Games' })).toBeInTheDocument();
  });

  /**
   * Installed as an app there is no browser chrome, so a page without a way
   * back is a page you cannot leave. The join page shipped without one.
   */
  it.each(['/scrabble', '/cricket', '/rummikub', '/yahtzee', '/join', '/join/AB23', '/settings'])(
    'gives %s a way back to the game list',
    (path) => {
      renderAt(path);
      expect(screen.getByRole('link', { name: 'All games' })).toHaveAttribute('href', '/');
    },
  );

  it('names every page it opens', () => {
    for (const [path, title] of [
      ['/scrabble', 'Scrabble'],
      ['/cricket', 'Cricket'],
      ['/rummikub', 'Rummikub'],
      ['/yahtzee', 'Yahtzee'],
      ['/join', 'Join a game'],
      ['/settings', 'Settings'],
    ] as const) {
      const { unmount } = renderAt(path);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('icons', () => {
  it('renders the game list with drawn icons, not emoji', () => {
    renderAt('/');
    const link = screen.getByRole('link', { name: /Scrabble/ });
    expect(link.querySelector('svg')).toBeInTheDocument();
  });

  // Emoji render differently on every platform and are not a substitute for an
  // icon set. Everything user-visible uses lucide or purpose-drawn SVG.
  it('has no emoji anywhere in the source', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const offenders: string[] = [];

    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          for (const [i, line] of readFileSync(full, 'utf8').split('\n').entries()) {
            if (emoji.test(line)) offenders.push(`${full}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    };
    for (const dir of SOURCE_DIRS) walk(resolve(process.cwd(), dir));

    expect(offenders).toEqual([]);
  });
});

describe('punctuation', () => {
  // House style is a plain hyphen; em and en dashes are not used anywhere.
  it('uses single dashes, not em or en dashes', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx?|css)$/.test(entry.name)) {
          for (const [i, line] of readFileSync(full, 'utf8').split('\n').entries()) {
            if (/[\u2013\u2014]/.test(line)) offenders.push(`${full}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    };
    for (const dir of SOURCE_DIRS) walk(resolve(process.cwd(), dir));

    expect(offenders).toEqual([]);
  });
});

describe('stylesheet', () => {
  // Regression: layout rules that set `display` silently beat the browser's
  // default `[hidden] { display: none }`, which left the dictionary stuck open.
  // jsdom does not apply the cascade, so assert the guard rule is present.
  it('forces hidden elements to stay hidden', () => {
    // import.meta.url is an http URL under the jsdom environment, so read from cwd.
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });
});
