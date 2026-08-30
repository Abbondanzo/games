/**
 * The settings page: how the app paints, and the name this device plays under.
 *
 * Both were previously only settable in passing - the scheme not at all, and
 * the name only by typing over it at the door - so these cover the whole of
 * each: what is shown, what is stored, and that the rest of the app reads back
 * what was chosen here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { readName, writeName } from '../rooms/storage';
import { THEME_KEY, applyStoredTheme, readTheme } from './theme';

const renderAt = (path: string) =>
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );

const openSettings = () => renderAt('/settings');

/** The root element and head outlive a render, unlike anything in the tree. */
afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.head.querySelector('meta[data-chosen]')?.remove();
});

describe('getting there', () => {
  it('is offered on the home page, under joining', async () => {
    const user = userEvent.setup();
    renderAt('/');

    const rows = screen.getAllByRole('link').map((link) => link.textContent ?? '');
    expect(rows.findIndex((row) => row.includes('Settings'))).toBeGreaterThan(
      rows.findIndex((row) => row.includes('Join a game')),
    );

    await user.click(screen.getByRole('link', { name: /Settings/ }));
    expect(screen.getByRole('group', { name: 'Colour scheme' })).toBeInTheDocument();
  });
});

describe('appearance', () => {
  const button = (name: string) => screen.getByRole('button', { name });

  it('starts on automatic, with nothing forced on the page', () => {
    openSettings();

    expect(button('Automatic')).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it.each(['Light', 'Dark'] as const)('paints in %s once chosen', async (label) => {
    const user = userEvent.setup();
    openSettings();

    await user.click(button(label));

    expect(document.documentElement.dataset.theme).toBe(label.toLowerCase());
    expect(button(label)).toHaveAttribute('aria-pressed', 'true');
    expect(button('Automatic')).toHaveAttribute('aria-pressed', 'false');
    expect(readTheme()).toBe(label.toLowerCase());
  });

  // Automatic is the absence of a choice on the page, not a third palette.
  it('hands the decision back to the device', async () => {
    const user = userEvent.setup();
    openSettings();

    await user.click(button('Dark'));
    await user.click(button('Automatic'));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(readTheme()).toBe('auto');
  });

  it('opens on the scheme last chosen', async () => {
    const user = userEvent.setup();
    const { unmount } = openSettings();
    await user.click(button('Light'));
    unmount();

    openSettings();
    expect(button('Light')).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies the stored scheme when the app boots', () => {
    localStorage.setItem(THEME_KEY, '"light"');

    applyStoredTheme();

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  // A stored value is as untrusted as anything else that can be hand edited.
  it('ignores a stored scheme that is not one of the three', () => {
    localStorage.setItem(THEME_KEY, '"neon"');

    applyStoredTheme();

    expect(readTheme()).toBe('auto');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('survives storage being unavailable', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    openSettings();

    await user.click(button('Dark'));

    expect(document.documentElement.dataset.theme).toBe('dark');
    vi.restoreAllMocks();
  });

  /**
   * Installed, the bar above the page is painted by a theme-color tag, and the
   * pair in index.html are keyed on the device rather than on the choice. The
   * override goes first, because the first tag that matches is the one used.
   */
  describe('the status bar', () => {
    const tint = () => document.head.querySelector('meta[data-chosen]');

    it('is repainted to match a chosen scheme', async () => {
      const user = userEvent.setup();
      openSettings();

      await user.click(button('Light'));

      expect(tint()).toHaveAttribute('content', '#f4f6fa');
      expect(document.head.firstElementChild).toBe(tint());

      await user.click(button('Dark'));
      expect(document.head.querySelectorAll('meta[data-chosen]')).toHaveLength(1);
      expect(tint()).toHaveAttribute('content', '#10131a');
    });

    it('is left to the device again on automatic', async () => {
      const user = userEvent.setup();
      openSettings();

      await user.click(button('Dark'));
      await user.click(button('Automatic'));

      expect(tint()).toBeNull();
    });
  });
});

describe('the name this device plays under', () => {
  const field = () => screen.getByLabelText('Name');

  it('starts empty, with nothing to forget', () => {
    openSettings();

    expect(field()).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Forget/ })).not.toBeInTheDocument();
  });

  it('opens on the name already stored', () => {
    writeName('Ada');
    openSettings();

    expect(field()).toHaveValue('Ada');
  });

  it('is stored as it is typed, so there is nothing to submit', async () => {
    const user = userEvent.setup();
    openSettings();

    await user.type(field(), 'Grace');

    expect(readName()).toBe('Grace');
  });

  /** The whole point of storing it: it is what the join page offers back. */
  it('is what the join page offers next time', async () => {
    const user = userEvent.setup();
    const { unmount } = openSettings();
    await user.type(field(), 'Grace');
    unmount();

    renderAt('/join');
    expect(screen.getByLabelText('Your name')).toHaveValue('Grace');
  });

  it('can be forgotten outright', async () => {
    const user = userEvent.setup();
    writeName('Ada');
    openSettings();

    await user.click(screen.getByRole('button', { name: /Forget/ }));

    expect(readName()).toBe('');
    expect(field()).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Forget/ })).not.toBeInTheDocument();
  });
});
