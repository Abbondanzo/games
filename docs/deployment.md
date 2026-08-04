# CI and deployment

`.github/workflows/ci.yml` runs on every push and pull request to `main`: install, type check,
test, build. It does not deploy - it exists to catch breakage before it reaches production, and
needs no secrets or write permissions.

Deployment is handled by the Cloudflare Pages Git integration, which builds from the repository
and publishes production (from `main`) and per-pull-request previews. Nothing about it lives in
this repo.

## Consequences worth knowing

**CI does not gate deployment.** Cloudflare builds independently, so a failing CI run does not
stop a deploy. To make it binding, add a branch protection rule on `main` requiring the `ci`
check, so a red build cannot be merged in the first place.

**Two origins serve the same build.** The custom domain and the `pages.dev` subdomain both
respond, and `localStorage` is per-origin, so a game saved on one is invisible on the other -
and installing from each gives two separate apps. `index.html` carries a `rel="canonical"`
pointing at the custom domain, which handles search engines but not the storage split. A
redirect rule from the `pages.dev` subdomain would fix that properly.

**The app is served from the site root.** `base` is `/` rather than relative, because a service
worker and manifest are scoped to the origin root. Subpath hosting is not supported.

## The room server

`worker/` is a separate Cloudflare Worker. It is not built by Pages and not touched by CI, so
the site and the room server are two independent artefacts that happen to share a repo. The
Worker carries no UI; the site carries no server. What they do share is `shared/`, imported by
both so the room runs the same scoring code the app does.

It is connected to the repo through Cloudflare's Workers Builds, which works the way the Pages
integration does:

| Setting | Value |
| --- | --- |
| Build command | `pnpm install --frozen-lockfile` |
| Deploy command | `pnpm worker:deploy` |
| Root directory | the repo root, where `wrangler.toml` is |
| Non-production branches | build, and **do not** deploy |

The install step is needed because the Worker bundles zod and the shared library. Connecting it
keeps API tokens out of the repo, which the GitHub Actions route would not.

**A Workers Builds project deploys one Worker, and it is the one it is connected to.** So a
non-production branch cannot publish a differently named Worker from here. Two attempts at making
it, both reverted, both worth not repeating:

- Pointing the non-production command at `wrangler deploy --env preview` does not publish
  `games-rooms-preview`. The name is overridden rather than refused, and the branch goes to
  **production** wearing staging's variables - including an origin list with no
  `games.abbondanzo.com` in it, which stops the live site opening a room at all. Recover with
  `pnpm worker:deploy` from a checkout of `main`.
- `wrangler versions upload --preview-alias staging` looks like the answer, and would be, except
  that [Cloudflare does not generate preview URLs for a Worker that implements a Durable
  Object](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/#limitations).
  This Worker is nothing but a Durable Object. The upload succeeds, the alias is recorded, and
  `staging-games-rooms.<subdomain>.workers.dev` resolves to nothing. It fails quietly, which is
  what makes it worth writing down.

So staging is a Worker of its own, deployed separately: by hand with `pnpm worker:deploy:staging`,
or by connecting `games-rooms-preview` as its own Workers Builds project, which is the only way a
build can publish it.

## Two room servers

There are two, and which one a build talks to is decided by the origin it is served from:

| Origin | Room server |
| --- | --- |
| `games.abbondanzo.com`, `games-ccu.pages.dev` | `games-rooms` |
| every preview, local dev, anything else | `games-rooms-preview` |

That decision lives in `roomsUrlFor` in `src/rooms/transport.ts` and is read from the page at
runtime, not from a build variable. A variable that has to be set in a dashboard is one that
will eventually be missing, and the failure would be silent: a preview writing into somebody's
real game. It is an allowlist, so an origin nobody anticipated gets staging, which is harmless.

Staging is the `preview` environment in `wrangler.toml`, and a Worker of its own called
`games-rooms-preview`. It has its own Durable Object storage, its own rate limit budget, and an
origin list that admits previews and localhost but not the live site. Deploy it with:

```
pnpm worker:deploy:staging
```

`VITE_ROOMS_URL` still overrides everything, for pointing at a wrangler running locally.

**A protocol change has somewhere to go.** Deploy staging, open the pull request, and the preview
exercises the new protocol against a room server that speaks it, without touching production.
Before staging existed a preview could only reach the live room server, so a preview of a
protocol change was guaranteed to show a version mismatch and could not be tested at all.

To have that happen without remembering, connect `games-rooms-preview` to this repo as a second
Workers Builds project - deploy command `pnpm worker:deploy:staging`, non-production branch
deploys turned on - so every branch push refreshes it. It has to be a second project rather than
a second command on the first, for the reason above.

**Staging is shared, and holds whatever was pushed last.** With one pull request in flight that
is invisible; with two, the second takes staging away from the first. Per-branch room servers
would need the Pages preview to discover its own branch's Worker URL at build time, which it has
no way to do.

## Is it up?

```
curl https://games-rooms.abbondanzo.workers.dev/health
curl https://games-rooms-preview.abbondanzo.workers.dev/health
```

```json
{ "ok": true, "protocol": 5, "games": ["scrabble", "cricket", "rummikub"],
  "version": "...", "commit": "...", "uploadedAt": "..." }
```

Every other route needs a room code, so without this an address that was never deployed and one
that is running answer much the same way. `protocol` is the part worth reading: it says whether
that room can talk to a given client, so a preview showing "This room needs updating" is answered
by comparing this against `PROTOCOL_VERSION` in the client. `commit` is the revision the version
was built from, which Workers Builds sets.

Open to any origin and never cached, so it can be curled from anywhere.

## Toolchain

Node 20+ and pnpm; `corepack enable` picks up the version pinned in `package.json`.

`pnpm-workspace.yaml` allows esbuild's postinstall, which fetches its platform binary. pnpm 11
blocks dependency build scripts by default, and because it re-runs install before every script,
a blocked build breaks `test` and `typecheck` as well as `build`. Note pnpm 11 renamed this
setting from `onlyBuiltDependencies` to `allowBuilds`; the old key is silently ignored.
