import type { Player } from '@shared/games/rummikub/types';

/**
 * Who went out. Asked the same way whether the round is being scored on one
 * phone or collected from everybody's, and the two must stay identical: both
 * are driven by accessible name in the tests, and a player picks from whichever
 * one their device happens to show.
 */
interface Props {
  players: readonly Player[];
  /** The player picked so far, or null. */
  value: string | null;
  onPick: (id: string) => void;
}

export function WinnerPick({ players, value, onPick }: Props) {
  return (
    <fieldset className="winner-pick">
      <legend>Who went out?</legend>
      <div className="seg wrap">
        {players.map((p) => (
          <button
            key={p.id}
            type="button"
            className={value === p.id ? 'on' : undefined}
            aria-pressed={value === p.id}
            onClick={() => onPick(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
