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
| Non-production branch command | `pnpm worker:upload:staging` |
| Root directory | the repo root, where `wrangler.toml` is |

The install step is needed because the Worker bundles zod and the shared library. Connecting it
keeps API tokens out of the repo, which the GitHub Actions route would not.

**A Workers Builds project deploys one Worker, and it is the one it is connected to.** So a
non-production branch cannot publish a *differently named* Worker from here. Pointing the
non-production command at `wrangler deploy --env preview` does not publish `games-rooms-preview`:
the name is overridden rather than refused, and the branch is published to **production** wearing
staging's variables - including an origin list with no `games.abbondanzo.com` in it, which stops
the live site opening a room at all. Tried, and reverted. If it happens again, recover with
`pnpm worker:deploy` from a checkout of `main`.

What works instead is a **preview version** of the same Worker:

```
wrangler versions upload --preview-alias staging
```

A version is uploaded but takes no traffic, so production carries on serving what it was
serving. The alias gives it a fixed address - `staging-games-rooms.abbondanzo.workers.dev` -
which is what makes it usable as a target the client can name, since an unaliased version URL
changes on every upload.

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

Staging is the `staging` preview alias of `games-rooms`, refreshed by every branch push.
`VITE_ROOMS_URL` still overrides everything, for pointing at a wrangler running locally.

**A protocol change has somewhere to go.** Push the branch: the Pages preview and the staging
version go up together, and the preview exercises the new protocol against a room server that
speaks it, while production carries on unchanged. Before staging existed a preview could only
reach the live room server, so a preview of a protocol change was guaranteed to show a version
mismatch and could not be tested at all.

**Staging is a version of production, not a copy of it.** That is the price of the alias, and it
is worth knowing exactly:

- **The rooms are the same rooms.** Durable Objects belong to the Worker, and a version is the
  same Worker, so a room made from a preview lives in the same storage as a real game and runs
  the branch's Durable Object code. Codes are random and rooms expire after four hours, so a
  collision is unlikely rather than impossible - but a branch that changes the shape of a
  snapshot is writing into storage the live site reads.
- **The variables are the same variables**, which is why `ALLOWED_ORIGINS` above has to admit
  previews as well as the live site. Narrowing it to the live site would leave the preview unable
  to reach its own staging alias.
- **The rate limit budget is the same budget.**

The `preview` environment in `wrangler.toml` still exists and is genuinely separate on all three
counts. `pnpm worker:deploy:staging` publishes it, and `pnpm worker:dev` runs it locally, which
is what admits a localhost origin. Connecting `games-rooms-preview` as its own Workers Builds
project is the way to get that isolation automatically, at the cost of a second project and a
second build on every push.

**Staging holds whatever was pushed last.** With one pull request in flight that is invisible;
with two, the second takes staging away from the first.

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
