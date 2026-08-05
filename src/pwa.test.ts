import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('recovering from a stale page', () => {
  it('watches for the page failing to load at all', () => {
    expect(html).toMatch(/addEventListener\(\s*'error'/);
    // Capture phase: a failed script or stylesheet does not bubble.
    expect(html).toMatch(/\},\s*true,?\s*\)/);
  });

  it('clears what this device is holding before trying again', () => {
    expect(html).toContain('caches');
    expect(html).toContain('unregister');
    expect(html).toContain('reload');
  });

  // Or a page that fails for any other reason would reload for ever.
  it('tries once, and remembers that it did', () => {
    expect(html).toContain('sessionStorage');
    expect(html).toContain('games.reload.v1');
  });

  /**
   * Offline, a failure to load means something else entirely, and throwing the
   * caches away would take the installed app with it.
   */
  it('does nothing without a connection', () => {
    expect(html).toContain('navigator.onLine');
  });

  it('is cleared once the app actually boots', () => {
    expect(read('src/main.tsx')).toContain('games.reload.v1');
  });

  // It has to run before the module it is watching for.
  it('is registered above the app script', () => {
    expect(html.indexOf('games.reload.v1')).toBeLessThan(html.indexOf('type="module"'));
  });

  // It is inline on purpose: a script that has to be fetched is a script that
  // can fail the same way as the one it is meant to rescue.
  it('is inline rather than a file of its own', () => {
    expect(html).not.toMatch(/<script[^>]*src="[^"]*recover/);
  });
});
