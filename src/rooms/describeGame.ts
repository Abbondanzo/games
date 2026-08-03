/**
 * What is on screen, in words, for the warning shown before sharing clears it.
 *
 * Returns null when there is nothing worth mentioning, so the warning only
 * appears when something would actually be lost.
 */
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function summarise(parts: [number, string][]): string | null {
  const said = parts.filter(([n]) => n > 0).map(([n, word]) => plural(n, word));
  if (!said.length) return null;
  if (said.length === 1) return said[0]!;
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}`;
}
