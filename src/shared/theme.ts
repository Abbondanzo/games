/**
 * Which colour scheme the app paints in.
 *
 * The stylesheet is dark, with a light palette that takes over under a light
 * device preference. Choosing outright sets `data-theme` on the root element,
 * which is what the two rules in the stylesheet key off; `auto` takes the
 * attribute away again and hands the decision back to the device.
 *
 * The same read runs inline in index.html, ahead of everything else, because a
 * dark page flashing white is precisely what someone who chose light did not
 * ask for. That copy and this one share `THEME_KEY`, and a test holds them to
 * it.
 */
import { z } from 'zod';
import { readJson, writeJson } from './localStore';

const ThemeSchema = z.enum(['auto', 'light', 'dark']);

export type Theme = z.infer<typeof ThemeSchema>;

export const THEME_KEY = 'games.theme.v1';

/** Nothing chosen means the device decides, which is the sane default. */
export const readTheme = (): Theme => readJson(THEME_KEY, ThemeSchema) ?? 'auto';

/** Paint in this scheme now, and in it again next time. */
export function setTheme(theme: Theme): void {
  writeJson(THEME_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  tintStatusBar(theme);
}

export const applyStoredTheme = (): void => applyTheme(readTheme());

/**
 * The page background, which is the status bar behind it once the app is
 * installed. Kept in step with the stylesheet and with index.html by a test,
 * since neither can be read from here: the tags in index.html are keyed on the
 * device preference, so a chosen scheme needs one that is not.
 */
const TINT: Record<Exclude<Theme, 'auto'>, string> = { light: '#f4f6fa', dark: '#10131a' };

const MARK = 'data-chosen';

function tintStatusBar(theme: Theme): void {
  const chosen = document.head.querySelector(`meta[${MARK}]`);
  if (theme === 'auto') {
    chosen?.remove();
    return;
  }

  const meta = chosen ?? document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute(MARK, '');
  meta.setAttribute('content', TINT[theme]);
  // First match wins, so this has to sit ahead of the pair it overrides.
  document.head.prepend(meta);
}
