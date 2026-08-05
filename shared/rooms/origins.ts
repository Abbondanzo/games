/**
 * Which origins may talk to the room server.
 *
 * This is a real security boundary, not a formality: WebSocket upgrades are not
 * subject to CORS, so the room checks the origin itself. Getting it wrong in one
 * direction blocks previews, and in the other lets any site open a socket.
 *
 * Pure, so it is tested with everything else rather than only in production.
 */

/**
 * A single leading `*.` wildcard is allowed, for hosts where every deployment
 * gets its own subdomain. Cloudflare Pages previews look like
 * `https://0fc473c3.games-ccu.pages.dev`, and only this project's deployments
 * ever land under that name, so allowing one extra label is safe.
 *
 * Anything broader is not: `*.pages.dev` would admit every site on the platform.
 */
export function isAllowedOrigin(origin: string, patterns: readonly string[]): boolean {
  if (!origin) return false;

  return patterns.some((raw) => {
    const pattern = raw.trim();
    if (!pattern) return false;
    if (pattern === origin) return true;

    const star = '://*.';
    const at = pattern.indexOf(star);
    if (at === -1) return false;

    // Scheme must match exactly; a wildcard is no excuse for downgrading.
    const scheme = pattern.slice(0, at + 3);
    if (!origin.startsWith(scheme)) return false;

    const suffix = pattern.slice(at + star.length); // the domain after "*."
    const host = origin.slice(scheme.length);
    if (!host.endsWith(`.${suffix}`)) return false;

    // Exactly one extra label, so a.b.example does not match *.example.
    const label = host.slice(0, host.length - suffix.length - 1);
    return label.length > 0 && !label.includes('.');
  });
}

export const parseOrigins = (value: string | undefined, fallback: readonly string[]): string[] =>
  value
    ? value
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [...fallback];
