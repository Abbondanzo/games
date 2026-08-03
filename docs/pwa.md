# Install and offline use

The app is a PWA. A Workbox service worker precaches every built asset, so once loaded it runs
with no connection. Only the Scrabble dictionary needs the network, and it says so clearly when
it cannot reach it.

- **iOS**: open in Safari, then Share > Add to Home Screen. It launches without browser chrome.
- **Android / desktop**: use the browser's install prompt.

Games are stored in `localStorage`, which is per-origin and survives installation, so a game
started in the browser is still there in the installed app. The corollary is that the Cloudflare
Pages subdomain and the custom domain keep separate saved games.

## Icons

Every icon is generated from one trophy drawing in `scripts/generate-icons.mjs`:

```
pnpm icons
```

Output goes to `public/` and is committed, so neither CI nor a deploy has to rasterise anything.
Three variants come out of the same artwork:

| Variant | Used for | Why it differs |
| --- | --- | --- |
| Rounded, transparent corners | `favicon.svg`, `favicon-16/32.png` | Sits on its own in a tab, so it carries its own rounding |
| Square, opaque | `apple-touch-icon.png`, `icon-192/512.png` | iOS and Android apply their own mask, so rounding here would clip the corners twice; iOS also composites on white, so alpha would show through |
| Square, artwork at 62% | `icon-maskable-512.png` | A maskable icon may be cropped to a circle, so content stays inside the safe zone |

UI icons come from [lucide-react](https://lucide.dev), tree-shaken so only the ones used are
bundled (about 2 kB gzipped). The cricket marks are purpose-drawn SVG, since no icon set has
scoreboard notation.

## iOS specifics

`viewport-fit=cover` plus `env(safe-area-inset-*)` padding keeps content clear of the notch and
the home indicator when launched from the home screen. Without `viewport-fit=cover` the insets
always resolve to zero.

Scoring controls set `touch-action: manipulation` to drop the double-tap zoom delay, and
suppress the tap highlight and text selection, so tapping tiles and dart targets feels like an
app rather than a web page.

`theme-color` is declared for both colour schemes, which tints the status bar area.

`src/pwa.test.ts` asserts the manifest fields, the icon sizes installers require, that every
referenced icon exists on disk, and that the iOS meta tags and safe-area CSS are present.

## Not implemented

iOS splash screens (`apple-touch-startup-image`). Without them there is a brief blank screen on
launch. Covering current iPhones and iPads takes roughly 20 more PNGs; the generator script
could produce them.
