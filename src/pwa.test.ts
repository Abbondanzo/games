import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = read('index.html');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

describe('web app manifest', () => {
  it('declares everything an install prompt needs', () => {
    expect(manifest).toMatchObject({
      name: 'Games',
      short_name: 'Games',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  // Android needs 192 and 512; a maskable icon stops the launcher cropping
  // the artwork when it applies its own shape.
  it('ships the icon sizes installers require', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('points only at files that exist', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(process.cwd(), 'public', icon.src.replace(/^\//, '')))).toBe(true);
    }
  });
});

describe('iOS home screen support', () => {
  // iOS ignores the manifest icons and reads apple-touch-icon instead.
  it('links an apple-touch-icon', () => {
    expect(html).toMatch(/<link[^>]+rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/);
    expect(existsSync(resolve(process.cwd(), 'public/apple-touch-icon.png'))).toBe(true);
  });

  it('asks to launch without browser chrome, with a title and status bar style', () => {
    expect(html).toMatch(/name="apple-mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/name="mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/name="apple-mobile-web-app-title" content="Games"/);
    expect(html).toMatch(/name="apple-mobile-web-app-status-bar-style"/);
  });

  // Without viewport-fit=cover the safe-area insets always resolve to zero.
  it('opts into the full screen so safe-area insets work', () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });

  // The Pages subdomain serves the same build, so search engines need to be
  // told which host is the real one.
  it('names a canonical host', () => {
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/games\.abbondanzo\.com\/"/);
  });

  it('tints the status bar for both colour schemes', () => {
    expect(html).toMatch(/name="theme-color" media="\(prefers-color-scheme: light\)"/);
    expect(html).toMatch(/name="theme-color" media="\(prefers-color-scheme: dark\)"/);
  });
});

describe('stylesheet', () => {
  const css = read('src/index.css');

  // Content would otherwise sit under the notch and the home indicator.
  it('keeps content clear of the device safe areas', () => {
    expect(css).toMatch(/padding-bottom:\s*calc\(3rem \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/env\(safe-area-inset-left\)/);
    expect(css).toMatch(/env\(safe-area-inset-right\)/);
  });

  it('makes scoring controls behave like app buttons', () => {
    expect(css).toMatch(/touch-action:\s*manipulation/);
    expect(css).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
  });
});

describe('favicons', () => {
  it('links an SVG icon with PNG fallbacks', () => {
    expect(html).toMatch(/<link[^>]+type="image\/svg\+xml"[^>]+href="\/favicon\.svg"/);
    expect(html).toMatch(/sizes="32x32"/);
    expect(html).toMatch(/sizes="16x16"/);
  });

  it('has every referenced file on disk', () => {
    for (const file of ['favicon.svg', 'favicon-32.png', 'favicon-16.png']) {
      expect(existsSync(resolve(process.cwd(), 'public', file))).toBe(true);
    }
  });
});

/**
 * Surviving a deploy.
 *
 * The failure these guard against: a browser holding an index.html from an
 * earlier deploy asks for a hashed file that deploy shipped, the new deployment
 * does not have it, and the host answers with an HTML page. The browser refuses
 * to run that as a module - "Expected a JavaScript-or-Wasm module script" - and
 * the page is blank.
 */
describe('cache headers', () => {
  const headers = read('public/_headers');

  /** The rule that applies to a path, as Pages reads the file top to bottom. */
  const ruleFor = (path: string): string => {
    const blocks = headers.split(/\n(?=\S)/);
    const block = blocks.find((b) => b.split('\n')[0]?.trim() === path);
    return block ?? '';
  };

  it.each(['/', '/index.html', '/sw.js', '/manifest.webmanifest'])(
    'keeps %s from being served stale',
    (path) => {
      expect(ruleFor(path)).toMatch(/Cache-Control:\s*no-cache/i);
    },
  );

  // Their names change when they do, so holding one forever is safe and is
  // what keeps a deploy from re-downloading everything.
  it('lets the hashed files be kept forever', () => {
    expect(ruleFor('/assets/*')).toMatch(/max-age=31536000/);
    expect(ruleFor('/assets/*')).toMatch(/immutable/);
  });

  it('does not let the hashed rule swallow the entry points', () => {
    expect(ruleFor('/')).not.toMatch(/immutable/);
    expect(ruleFor('/index.html')).not.toMatch(/immutable/);
  });

  it('is shipped, not just written', () => {
    // Pages reads it from the root of what was published.
    expect(existsSync(resolve(process.cwd(), 'public/_headers'))).toBe(true);
  });
});

/**
 * A chosen colour scheme, which three files have to agree on: the stylesheet
 * paints it, index.html applies it before the first paint, and theme.ts owns
 * the key and the status bar tint. Drift between them shows up as a flash of
 * the wrong colour, which is the one thing the inline copy exists to prevent.
 */
describe('the chosen colour scheme', () => {
  const css = read('src/index.css');
  const theme = read('src/shared/theme.ts');

  it('is read inline, before the app script that would repaint it', () => {
    expect(html).toContain('games.theme.v1');
    expect(html.indexOf('games.theme.v1')).toBeLessThan(html.indexOf('type="module"'));
    expect(theme).toContain("THEME_KEY = 'games.theme.v1'");
  });

  it('is what the stylesheet keys the light palette off', () => {
    expect(css).toMatch(/:root:not\(\[data-theme='dark'\]\)/);
    expect(css).toMatch(/:root\[data-theme='light'\]/);
  });

  // The pair above are keyed on the device, so neither answers for a choice.
  it('tints the status bar in the same colours as the page', () => {
    for (const [scheme, colour] of [
      ['light', '#f4f6fa'],
      ['dark', '#10131a'],
    ] as const) {
      expect(css).toContain(`--bg: ${colour}`);
      expect(html).toContain(`media="(prefers-color-scheme: ${scheme})" content="${colour}"`);
      expect(theme).toContain(`${scheme}: '${colour}'`);
    }
  });
});

const MARK = 'games.reload.v1';

/**
 * The recovery script out of index.html itself, so these tests hold the code
 * that ships rather than a copy of it. It reaches for window, navigator and
 * sessionStorage as globals, which is what lets them be substituted here;
 * document is jsdom's own, so #root is a real element.
 */
const recoveryScript = (() => {
  const blocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? [];
  const block = blocks.find((b) => b.includes(MARK));
  if (!block) throw new Error('index.html has no recovery script');
  return block.replace('<script>', '').replace('</script>', '');
})();

type AssetFailure = { target: { tagName: string } };

function runRecovery({ online = true, mark }: { online?: boolean; mark?: string } = {}) {
  const handlers: ((event: AssetFailure) => void)[] = [];
  const stored = new Map<string, string>();
  if (mark !== undefined) stored.set(MARK, mark);
  const counts = { reloads: 0, cachesDeleted: 0, unregistered: 0 };

  const win = {
    addEventListener: (type: string, handler: (event: AssetFailure) => void, capture: boolean) => {
      // Capture phase only: a failed script or stylesheet does not bubble, so a
      // handler registered any other way would never hear about one.
      if (type === 'error' && capture) handlers.push(handler);
    },
    location: {
      reload: () => {
        counts.reloads += 1;
      },
    },
    caches: {
      keys: () => Promise.resolve(['workbox-precache-v2']),
      delete: () => {
        counts.cachesDeleted += 1;
        return Promise.resolve(true);
      },
    },
  };
  const nav = {
    onLine: online,
    serviceWorker: {
      getRegistrations: () =>
        Promise.resolve([
          {
            unregister: () => {
              counts.unregistered += 1;
              return Promise.resolve(true);
            },
          },
        ]),
    },
  };
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  };

  new Function('window', 'navigator', 'sessionStorage', recoveryScript)(win, nav, storage);

  return {
    counts,
    mark: () => stored.get(MARK) ?? null,
    async fail(tagName = 'SCRIPT') {
      for (const handler of handlers) handler({ target: { tagName } });
      // The clearing is a promise chain; a turn of the loop settles it.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('recovering from a stale page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('clears what this device is holding before trying again', async () => {
    const page = runRecovery();
    await page.fail();
    expect(page.counts).toMatchObject({ cachesDeleted: 1, unregistered: 1, reloads: 1 });
    expect(page.mark()).not.toBeNull();
  });

  /**
   * The loop this guard exists for. A deploy left a chunk missing, the page
   * reloaded, booted, asked for the chunk again and reloaded again, for ever.
   * main.tsx used to clear the mark as soon as the bundle ran, so the guard was
   * always clear by the time the failure came round and no refresh, hard or
   * otherwise, could break out of it.
   */
  it('holds still when the same failure comes back on the next load', async () => {
    const page = runRecovery({ mark: String(Date.now()) });
    await page.fail();
    expect(page.counts.reloads).toBe(0);
  });

  // Which is the other half of that loop: the chunks fetched after the app has
  // started - the word list, and the service worker's own library - fail long
  // after there is anything blank to rescue.
  it('leaves an app that is already on screen alone', async () => {
    document.body.innerHTML = '<div id="root"><main>Scrabble</main></div>';
    const page = runRecovery();
    await page.fail('LINK');
    expect(page.counts.reloads).toBe(0);
  });

  it('tries again once the last attempt is old news', async () => {
    const page = runRecovery({ mark: '0' });
    await page.fail();
    expect(page.counts.reloads).toBe(1);
  });

  /**
   * Offline, a failure to load means something else entirely, and throwing the
   * caches away would take the installed app with it.
   */
  it('does nothing without a connection', async () => {
    const page = runRecovery({ online: false });
    await page.fail();
    expect(page.counts).toMatchObject({ cachesDeleted: 0, reloads: 0 });
  });

  it('ignores anything that is not a script or a stylesheet', async () => {
    const page = runRecovery();
    await page.fail('IMG');
    expect(page.counts.reloads).toBe(0);
  });

  // It is what defeated the guard, so the app must keep its hands off it.
  it('is not cleared by the app booting', () => {
    expect(read('src/main.tsx')).not.toContain(MARK);
  });

  // It has to run before the module it is watching for.
  it('is registered above the app script', () => {
    expect(html.indexOf(MARK)).toBeLessThan(html.indexOf('type="module"'));
  });

  // It is inline on purpose: a script that has to be fetched is a script that
  // can fail the same way as the one it is meant to rescue.
  it('is inline rather than a file of its own', () => {
    expect(html).not.toMatch(/<script[^>]*src="[^"]*recover/);
  });
});
