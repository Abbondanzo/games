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

## Toolchain

Node 20+ and pnpm; `corepack enable` picks up the version pinned in `package.json`.

`pnpm-workspace.yaml` allows esbuild's postinstall, which fetches its platform binary. pnpm 11
blocks dependency build scripts by default, and because it re-runs install before every script,
a blocked build breaks `test` and `typecheck` as well as `build`. Note pnpm 11 renamed this
setting from `onlyBuiltDependencies` to `allowBuilds`; the old key is silently ignored.
