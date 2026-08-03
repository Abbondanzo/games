import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, parseOrigins } from './origins';

const ALLOWED = [
  'https://games.abbondanzo.com',
  'https://games-ccu.pages.dev',
  'https://*.games-ccu.pages.dev',
  'http://localhost:5173',
];

const allows = (origin: string) => isAllowedOrigin(origin, ALLOWED);

describe('exact origins', () => {
  it.each([
    'https://games.abbondanzo.com',
    'https://games-ccu.pages.dev',
    'http://localhost:5173',
  ])('allows %s', (origin) => {
    expect(allows(origin)).toBe(true);
  });

  it.each([
    ['a different site', 'https://evil.example'],
    ['the wrong port', 'http://localhost:9999'],
    ['nothing at all', ''],
  ])('refuses %s', (_label, origin) => {
    expect(allows(origin)).toBe(false);
  });
});

/** Every Pages deployment gets its own subdomain, previews included. */
describe('preview deployments', () => {
  it.each([
    'https://0fc473c3.games-ccu.pages.dev',
    'https://rooms.games-ccu.pages.dev',
    'https://some-branch-name.games-ccu.pages.dev',
  ])('allows %s', (origin) => {
    expect(allows(origin)).toBe(true);
  });

  // The wildcard covers one label under one project, and nothing else.
  it.each([
    ['another project on the same platform', 'https://someone-else.pages.dev'],
    ['a deeper subdomain', 'https://a.b.games-ccu.pages.dev'],
    ['a lookalike suffix', 'https://evil-games-ccu.pages.dev'],
    ['the domain used as a prefix', 'https://games-ccu.pages.dev.evil.example'],
    ['an empty label', 'https://.games-ccu.pages.dev'],
  ])('refuses %s', (_label, origin) => {
    expect(allows(origin)).toBe(false);
  });

  // A wildcard is not an excuse to accept plain http.
  it('refuses the right host over the wrong scheme', () => {
    expect(allows('http://0fc473c3.games-ccu.pages.dev')).toBe(false);
  });
});

describe('parseOrigins', () => {
  it('splits and trims a configured list', () => {
    expect(parseOrigins('https://a.test, https://b.test ', [])).toEqual([
      'https://a.test',
      'https://b.test',
    ]);
  });

  it('falls back when nothing is configured', () => {
    expect(parseOrigins(undefined, ['https://fallback.test'])).toEqual(['https://fallback.test']);
  });

  it('ignores empty entries from a trailing comma', () => {
    expect(parseOrigins('https://a.test,', [])).toEqual(['https://a.test']);
  });
});
