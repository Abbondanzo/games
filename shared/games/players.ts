/**
 * The parts of a roster that every game handles the same way.
 *
 * Three reducers were each carrying their own copy of these. They agreed, which
 * is the good case; the risk is the fourth copy, or the day one of them is
 * fixed and the others are not. Pure, and shared with the Worker like the rest
 * of this directory.
 */

interface Identified {
  id: string;
}

interface Named extends Identified {
  name: string;
}

/**
 * "Ada, Grace" adds both. Pasting a list is the fastest way to set a game up,
 * and it is how every game reads the field.
 */
export const parseNames = (raw: string): string[] =>
  raw.split(',').map((n) => n.trim()).filter(Boolean);

/**
 * Renaming, or null when there is nothing to do.
 *
 * Null rather than the original list because the caller has to hand its own
 * state back untouched: a reducer signals a no-op by identity, and the room
 * reads that to decide whether to bump its revision and tell everybody.
 */
export const renamedTo = <P extends Named>(
  players: readonly P[],
  id: string,
  name: string,
): P[] | null => {
  const wanted = name.trim();
  if (!wanted) return null;
  return players.map((p) => (p.id === id ? { ...p, name: wanted } : p));
};

/**
 * A roster with one player moved, or null when there is nothing to do.
 *
 * Null rather than the list back, for the same reason `renamedTo` does it: a
 * reducer signals a no-op by identity, and the room reads that to decide
 * whether to bump its revision and tell everybody about nothing.
 */
export const movedTo = <P extends Identified>(
  players: readonly P[],
  id: string,
  to: number,
): P[] | null => {
  const from = players.findIndex((p) => p.id === id);
  if (from === -1) return null;

  // Moving off either end is a request to go as far as there is; landing back
  // on your own place is nothing at all.
  const target = Math.min(Math.max(to, 0), players.length - 1);
  if (target === from) return null;

  const next = [...players];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return next;
};

/** Whoever is up next, wrapping round, and 0 when there is nobody. */
export const advance = (index: number, count: number): number =>
  (count ? (index + 1) % count : 0);

/**
 * Where the turn pointer goes when a player leaves.
 *
 * Keep the same player up, not the same seat number. If the player who was up
 * is the one leaving, the next in order takes over - which is the removed
 * player's own index once everyone after them has shifted down.
 *
 * Takes the roster from before the removal, since that is what says who was up.
 */
export const indexAfterRemoval = <P extends Identified>(
  before: readonly P[],
  currentIndex: number,
  removedId: string,
): number => {
  const removedAt = before.findIndex((p) => p.id === removedId);
  const after = before.filter((p) => p.id !== removedId);
  if (!after.length) return 0;

  const upNow = before[currentIndex]?.id;
  const stillHere = upNow !== undefined && upNow !== removedId
    ? after.findIndex((p) => p.id === upNow)
    : -1;

  return stillHere === -1 ? removedAt % after.length : stillHere;
};
