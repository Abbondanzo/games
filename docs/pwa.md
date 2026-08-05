# Install and offline use

The app is a PWA. A Workbox service worker precaches every built asset, so once loaded it runs
with no connection. Two things do need the network, and both say so plainly when they cannot
reach it: the Scrabble dictionary, and [shared rooms](rooms.md). Playing alone never does.

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

| Variant                      | Used for                                   | Why it differs                                                                                                                                 |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Rounded, transparent corners | `favicon.svg`, `favicon-16/32.png`         | Sits on its own in a tab, so it carries its own rounding                                                                                       |
| Square, opaque               | `apple-touch-icon.png`, `icon-192/512.png` | iOS and Android apply their own mask, so rounding here would clip the corners twice; iOS also composites on white, so alpha would show through |
| Square, artwork at 62%       | `icon-maskable-512.png`                    | A maskable icon may be cropped to a circle, so content stays inside the safe zone                                                              |

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

## Updates

The app is precached, so a deploy does not reach anyone holding a tab open: the
new files arrive in the background, but the page keeps running the code it
started with until it reloads.

That went wrong twice while rooms were being built. A "Close room" button did
nothing, because the deployed room server predated the message it sends. A host
naming dialog only appeared after a hard refresh. Both looked like bugs.

So the service worker waits rather than swapping underneath you: when a new
version is ready a small bar offers **Refresh**, which activates it and reloads.
The registration also re-checks hourly, since a game can sit open all evening.

`docs/rooms.md` covers the related case where the app and the room server are
different versions, which the room strip reports in the same spirit.

## Not implemented

iOS splash screens (`apple-touch-startup-image`). Without them there is a brief blank screen on
launch. Covering current iPhones and iPads takes roughly 20 more PNGs; the generator script
could produce them.
