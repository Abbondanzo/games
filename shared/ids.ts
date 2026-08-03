/**
 * Mints ids for new players, turns and rounds.
 *
 * Injectable because the reducers run in two places: in the browser for a solo
 * game, and in the room server, which must mint ids authoritatively so that
 * every client agrees on them.
 */
export type IdSource = () => string;

export const createIdSource = (): IdSource => {
  let counter = 0;
  return () => `${Date.now().toString(36)}-${counter++}`;
};
