import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { HINTS, LABELS, scoreOptions, YAHTZEE_BONUS } from '@shared/games/yahtzee/rules';
import type { Sheet } from '@shared/games/yahtzee/rules';
import type { Player } from '@shared/games/yahtzee/types';
import { WhoseTurn } from '../../rooms/WhoseTurn';
import type { Selection } from './ScoreSheet';

interface Props {
  /** The box that was tapped, and whose sheet it is on. */
  selection: Selection;
  player: Player;
  sheet: Sheet;
  onScore: (value: number) => void;
  onClear: () => void;
  onAddBonus: () => void;
  onRemoveBonus: () => void;
  onCancel: () => void;
  disabled?: boolean;
  /** Null when playing alone, where every turn is yours. */
  yourTurn: boolean | null;
  currentName: string | null;
}

/**
 * What a box will take, as buttons.
 *
 * Every number a box can hold is on screen, so filling one in is a tap rather
 * than a keyboard and a check afterwards: an upper box only holds multiples of
 * its own face, the fixed combinations hold their one number, and the three
 * that add the whole hand hold any sum five dice can make. A turn that scored
 * nothing is the same two taps as one that scored, which is the point - it is
 * the commonest entry of the game and the easiest one to leave out.
 */
export function ScorePad({
  selection,
  player,
  sheet,
  onScore,
  onClear,
  onAddBonus,
  onRemoveBonus,
  onCancel,
  disabled = false,
  yourTurn,
  currentName,
}: Props) {
  const tone = yourTurn === null ? '' : yourTurn ? ' yours' : ' theirs';

  /**
   * A full sheet is taller than a phone, so a box tapped near the top opens a
   * pad below the fold. Bringing it into view is the difference between two
   * taps and two taps and a scroll. Guarded because jsdom has no such method.
   */
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    card.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selection.playerId, selection.category]);

  const head = (title: string) => (
    <div className="card-head">
      <h2>{title}</h2>
      <button type="button" className="link" onClick={onCancel}>
        <X size={14} aria-hidden="true" /> Cancel
      </button>
    </div>
  );

  if (selection.category === 'yahtzeeBonus') {
    return (
      <section className={`card entry${tone}`} ref={card}>
        {head(`Extra Yahtzees for ${player.name}`)}
        <p className="hint">
          A Yahtzee rolled after the box is already worth 50 scores another {YAHTZEE_BONUS}. The
          roll still has to go in another box.
        </p>
        <div className="pad" role="group" aria-label="Extra Yahtzees">
          <button
            type="button"
            className="primary"
            disabled={disabled}
            aria-label="Add an extra Yahtzee"
            onClick={onAddBonus}
          >
            Add {YAHTZEE_BONUS}
          </button>
          {sheet.extraYahtzees > 0 && (
            <button
              type="button"
              className="ghost danger"
              disabled={disabled}
              aria-label="Take back an extra Yahtzee"
              onClick={onRemoveBonus}
            >
              Take one back
            </button>
          )}
        </div>
        <p className="hint">
          {sheet.extraYahtzees} so far, worth {sheet.bonusPoints}.
        </p>
      </section>
    );
  }

  const category = selection.category;
  // Every box offers a scratch, and it is always the first option.
  const [scratch = 0, ...values] = scoreOptions(category);
  const current = sheet.scores[category];

  return (
    <section className={`card entry${tone}`} ref={card}>
      {head(`${LABELS[category]} for ${player.name}`)}

      {/* In a room this is what says whether the pad will take anything. Alone
          it would only repeat the heading, and it is said on the card the
          heading replaced. */}
      {yourTurn !== null && (
        <WhoseTurn
          name={currentName}
          yours={yourTurn}
          nowPlaying="Now playing"
          yoursLabel="Your turn"
          empty="Nobody is up yet."
        />
      )}

      <p className="hint">{HINTS[category]}.</p>

      <div className="pad" role="group" aria-label={`Score for ${LABELS[category]}`}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className={`key${current === value ? ' on' : ''}`}
            aria-label={`Score ${value}`}
            aria-pressed={current === value}
            disabled={disabled}
            onClick={() => onScore(value)}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="pad-actions">
        <button
          type="button"
          className={`ghost danger${current === scratch ? ' on' : ''}`}
          aria-label="Scratch this box"
          aria-pressed={current === scratch}
          disabled={disabled}
          onClick={() => onScore(scratch)}
        >
          Scratch for 0
        </button>
        {current !== undefined && (
          <button type="button" className="link" disabled={disabled} onClick={onClear}>
            Empty this box
          </button>
        )}
      </div>
    </section>
  );
}
