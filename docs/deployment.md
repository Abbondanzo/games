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

Deploy it by hand with `pnpm worker:deploy`, or connect the repo to it with Cloudflare's Workers
Builds, which works the same way the Pages integration does:

| Setting | Value |
| --- | --- |
| Build command | `pnpm install --frozen-lockfile` |
| Deploy command | `pnpm worker:deploy` |
| Root directory | the repo root, where `wrangler.toml` is |

The install step is needed because the Worker bundles zod and the shared library. Connecting it
keeps API tokens out of the repo, which the GitHub Actions route would not.

**Both auto-deploying means they race.** If Pages wins, new clients briefly talk to an old room.
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
