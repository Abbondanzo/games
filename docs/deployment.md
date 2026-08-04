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

**Only deploy from `main`.** The deploy command is a plain `wrangler deploy`, which publishes
production. If non-production branch deployments are turned on, every branch would publish over
the live room server. Non-production branches should build and stop.

A branch cannot usefully deploy a room server of its own from here, and two attempts are written
up in [rooms.md](rooms.md) so they are not tried a third time.

## There is one room server, and previews use it

Cloudflare Pages gives every pull request a preview, but there is no matching preview of the
room server. A preview build talks to **production**:

| Client | Room server |
| --- | --- |
| the live site | `games-rooms` |
| a pull request preview | `games-rooms` |
| local dev | `games-rooms`, unless `VITE_ROOMS_URL` says otherwise |

That is a deliberate trade rather than an oversight. A second room server means a second Workers
Builds project and a second build on every push, which doubles the spend against the free tier
for a score sheet. Two things follow from it, and both matter:

**A room made from a preview is a real room.** It lives in the same Durable Object storage as
everybody's live games, under a code from the same space, and holds real people's names. Nothing
stops a preview creating, locking or closing rooms. Treat a preview as production with a
different coat of paint.

**A preview cannot exercise a protocol change at all.** A branch that bumps `PROTOCOL_VERSION`
produces a preview client that is ahead of the deployed room, so every session shows "This app is
out of date" or its counterpart and the new message is refused. There is nothing to be learned
from that preview. Run it locally instead.

## Trying a change without touching real games

```
pnpm worker:dev                                   # the room server on :8787
VITE_ROOMS_URL=http://localhost:8787 pnpm dev     # the app, pointed at it
```

That is the isolated setup: a room server with its own local storage, and a client that talks to
it. It is the only way to try a protocol change honestly, and the way to try anything that writes
to a room without writing to somebody's game.

Two devices are worth the trouble here. `wrangler dev` binds a port on the machine, so a phone on
the same network can reach it, which is what the manual checklist in [rooms.md](rooms.md) needs.

**Deploy the Worker before the client** when a protocol changes. The app is precached, so a
client can be weeks old, and an old room rejects a frame it has never heard of. `pnpm
worker:deploy` from `main`, then push.

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
