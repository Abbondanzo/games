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
integration does, except that it takes two deploy commands - one for the production branch and
one for everything else:

| Setting | Value |
| --- | --- |
| Build command | `pnpm install --frozen-lockfile` |
| Deploy command | `pnpm worker:deploy` |
| Non-production branch deploy command | `pnpm worker:deploy:staging` |
| Root directory | the repo root, where `wrangler.toml` is |

The install step is needed because the Worker bundles zod and the shared library. Connecting it
keeps API tokens out of the repo, which the GitHub Actions route would not.

So `main` publishes production and every other branch publishes staging, and **which one a
branch can reach is settled by Cloudflare rather than by anything in this repo**. That is worth
keeping. A single deploy command that worked the branch out for itself would put the decision in
a script living on the branch being deployed, where neither branch protection nor review would
catch a mistake, because the branch is not `main`.

Deploy by hand with `pnpm worker:deploy` or `pnpm worker:deploy:staging` if you ever need to -
for a breaking protocol change, where the Worker has to lead the client.

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

Staging is the `preview` environment in `wrangler.toml`. It has its own Durable Object storage,
its own rate limit budget, and an origin list that admits previews and localhost but not the
live site. Pushing any branch but `main` deploys it, so it carries whatever was pushed last.
`VITE_ROOMS_URL` still overrides everything, for pointing at a wrangler running locally.

**A protocol change has somewhere to go.** Push the branch and both halves of it deploy: the
Pages preview and the staging room server. The preview exercises the new protocol against a room
that speaks it, without touching production. Before staging existed a preview could only reach
the live room server, so a preview of a protocol change was guaranteed to show a version mismatch
and could not be tested at all.

**Staging is shared, and holds the last branch pushed.** With one pull request in flight that is
invisible; with two, the second push takes staging away from the first. Per-branch room servers
would need the Pages preview to discover its own branch's Worker URL at build time, which it has
no way to do.

**Staging does not track `main`.** A merge deploys production and leaves staging where it was,
until the next branch push. That is the right way round - staging exists to run ahead - but it
means staging is not a mirror of production and should not be read as one.

**Both auto-deploying means they race**, on `main`. If Pages wins, new clients briefly talk to an old room.
That is worth knowing but not worth avoiding: the app is precached, so some clients are stale
whatever the deploy order, which is why the version banner exists. For a breaking protocol
change, deploy the Worker by hand first and then push.

Deploy the Worker first when a client-to-server message is added. The app is precached by a service
worker, so a client can be running weeks-old code; protocol changes have to stay additive. See
[rooms.md](rooms.md).

## Toolchain

Node 20+ and pnpm; `corepack enable` picks up the version pinned in `package.json`.

`pnpm-workspace.yaml` allows esbuild's postinstall, which fetches its platform binary. pnpm 11
blocks dependency build scripts by default, and because it re-runs install before every script,
a blocked build breaks `test` and `typecheck` as well as `build`. Note pnpm 11 renamed this
setting from `onlyBuiltDependencies` to `allowBuilds`; the old key is silently ignored.
