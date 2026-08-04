/**
 * Whose turn it is, said from the reader's point of view.
 *
 * "Now playing: Ada" is fine on one shared phone and useless at a table where
 * everyone is looking at their own: each of them has to remember which name
 * they typed. In a room this says "Your turn" or names who is holding things
 * up, and announces the change so it does not have to be noticed.
 *
 * The wording belongs to each game and is passed in; the three-state logic
 * lives here, because that is the part two games must not disagree about.
 */

/** Nothing to say alone, or before anyone is playing. */
export type TurnTone = '' | 'yours' | 'theirs';

/**
 * `yours` is null when playing alone, where every turn is yours and saying so
 * would be noise. That is why it is three states rather than a boolean.
 */
export const turnTone = (name: string | null, yours: boolean | null): TurnTone =>
  (yours === null || !name ? '' : yours ? 'yours' : 'theirs');

interface Props {
  /** Who is up, or null when there is nobody yet. */
  name: string | null;
  yours: boolean | null;
  /** What this game calls being up, for the solo wording: "Now playing". */
  nowPlaying: string;
  /** What to call it being yours: "Your turn", "Your throw". */
  yoursLabel: string;
  /** Shown when there is nobody up at all. */
  empty: string;
}

export function WhoseTurn({ name, yours, nowPlaying, yoursLabel, empty }: Props) {
  const tone = turnTone(name, yours);

  let said: JSX.Element | string;
  if (!name) said = empty;
  else if (tone === 'yours') said = <b>{yoursLabel}</b>;
  else if (tone === 'theirs') said = <>Waiting for <b>{name}</b></>;
  else said = <>{nowPlaying}: <b>{name}</b></>;

  return (
    <div className={`whose-turn${tone ? ` ${tone}` : ''}`} role="status">
      {said}
    </div>
  );
}
