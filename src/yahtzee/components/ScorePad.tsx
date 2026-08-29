import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  DICE,
  FACES,
  HINTS,
  kindOf,
  kindTotals,
  LABELS,
  scoreOptions,
  spareDice,
  spareTotals,
  YAHTZEE_BONUS,
} from '@shared/games/yahtzee/rules';
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

const DIE_FACES = Array.from({ length: FACES }, (_, i) => i + 1);

const COUNT_WORD: Record<number, string> = { 3: 'three', 4: 'four' };

/** Which die is being asked for, said the way it is said at the table. */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

/** How many dice are still to come, once at least one is in. */
const MORE: Record<number, string> = {
  1: 'One more die.',
  2: 'Two more dice.',
  3: 'Three more dice.',
  4: 'Four more dice.',
};

/**
 * What a box will take, as buttons.
 *
 * Most boxes are one tap: an upper box holds multiples of its own face, a fixed
 * combination holds its one number. A turn that scored nothing is the same two
 * taps as one that scored, which is the point - it is the commonest entry of
 * the game and the easiest one to leave out.
 *
 * The two of-a-kind boxes are asked for the way they are said at the table:
 * which number you got four of, and then what the odd die was. That is not
 * politeness, it is what makes the entry safe. Four fives cannot come to 7, but
 * "any total from 5 to 30" cannot say so, because taken on its own every one of
 * those totals is some four of a kind. Only the matched face rules the rest of
 * them out.
 *
 * Chance is asked for as the dice too, one at a time, because there is nothing
 * to match and so nothing to add up on your behalf: a hand of 6 4 4 3 2 is read
 * off the table as it lies, and adding it in your head before typing it is the
 * step that gets it wrong. Each key carries what the hand comes to with that
 * die in it, so the fifth tap writes a total that was on screen before it was
 * taken.
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

  /** The face picked in the first step, for the boxes that have two. */
  const [face, setFace] = useState<number | null>(null);

  /** The dice tapped in so far, for the box that is entered die by die. */
  const [dice, setDice] = useState<number[]>([]);
  const running = dice.reduce((a, b) => a + b, 0);

  /**
   * Stepping between the two halves replaces every key, which leaves a
   * keyboard on the body with nothing selected. Only a step moves focus; the
   * pad opening does not, or tapping a box would take the caret off the sheet.
   */
  const pad = useRef<HTMLDivElement>(null);
  const stepped = useRef(false);
  const step = (to: number | null) => {
    stepped.current = true;
    setFace(to);
  };
  useEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    pad.current?.querySelector('button')?.focus();
  }, [face]);

  /**
   * A full sheet is taller than a phone, so a box tapped near the top opens a
   * pad below the fold. Bringing it into view is the difference between two
   * taps and two taps and a scroll. Guarded because jsdom has no such method.
   */
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    setFace(null);
    setDice([]);
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
  const [scratch = 0, ...totals] = scoreOptions(category);
  const current = sheet.scores[category];
  const kind = kindOf(category);
  const spare = kind === null ? 0 : spareDice(kind);

  const keyFor = (value: number, main: number, sub: string, label: string) => (
    <button
      key={value}
      type="button"
      className={`key tall${current === value ? ' on' : ''}`}
      aria-label={label}
      aria-pressed={current === value}
      disabled={disabled}
      onClick={() => onScore(value)}
    >
      <span className="k-main">{main}</span>
      <span className="k-sub">{sub}</span>
    </button>
  );

  /* ── the four shapes the keys take ── */

  let hint: string;
  let groupLabel: string;
  let keys: JSX.Element[];

  if (category === 'chance') {
    const first = dice.length === 0;
    const last = dice.length === DICE - 1;
    hint = first ? 'Tap each of your five dice.' : `${MORE[DICE - dice.length]} ${running} so far.`;
    groupLabel = `The ${ORDINALS[dice.length]} die`;
    keys = DIE_FACES.map((value) => {
      const total = running + value;
      // Only the fifth key writes anything, so only it names the total.
      const label = last ? `Die showing ${value}, scores ${total}` : `Die showing ${value}`;

      return (
        <button
          key={value}
          type="button"
          className={`key${first ? '' : ' tall'}`}
          aria-label={label}
          disabled={disabled}
          onClick={() => (last ? onScore(total) : setDice([...dice, value]))}
        >
          {first ? (
            value
          ) : (
            <>
              <span className="k-main">{value}</span>
              <span className="k-sub">{total}</span>
            </>
          )}
        </button>
      );
    });
  } else if (kind === null) {
    hint = `${HINTS[category]}.`;
    groupLabel = `Score for ${LABELS[category]}`;
    keys = totals.map((value) => (
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
    ));
  } else if (face === null) {
    hint = `Which number did you get ${COUNT_WORD[kind]} of?`;
    groupLabel = `The number for ${LABELS[category]}`;
    keys = DIE_FACES.map((value) => {
      const range = kindTotals(kind, value);
      return (
        <button
          key={value}
          type="button"
          className="key tall"
          aria-label={`${LABELS[category]} on ${value}`}
          disabled={disabled}
          onClick={() => step(value)}
        >
          <span className="k-main">{value}</span>
          <span className="k-sub">
            {range[0]} to {range[range.length - 1]}
          </span>
        </button>
      );
    });
  } else {
    hint =
      spare === 1
        ? `${COUNT_WORD[kind]} ${face}s. What was the other die?`
        : `${COUNT_WORD[kind]} ${face}s. What did the other two dice add up to?`;
    hint = hint.charAt(0).toUpperCase() + hint.slice(1);
    groupLabel = spare === 1 ? 'The other die' : 'The other two dice';
    keys = spareTotals(kind).map((rest) =>
      keyFor(
        kind * face + rest,
        rest,
        String(kind * face + rest),
        spare === 1
          ? `Other die ${rest}, total ${kind * face + rest}`
          : `Other dice ${rest}, total ${kind * face + rest}`,
      ),
    );
  }

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

      <p className="hint">{hint}</p>

      {category === 'chance' && (
        <div className="dice-run">
          {dice.map((value, at) => (
            <button
              key={at}
              type="button"
              className="die"
              aria-label={`Take back the ${ORDINALS[at]} die, showing ${value}`}
              disabled={disabled}
              onClick={() => setDice(dice.filter((_, i) => i !== at))}
            >
              {value}
            </button>
          ))}
          {Array.from({ length: DICE - dice.length }, (_, at) => (
            <span key={`empty-${at}`} className="die empty" aria-hidden="true" />
          ))}
        </div>
      )}

      <div className="pad" role="group" aria-label={groupLabel} ref={pad}>
        {keys}
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
        {face !== null && (
          <button type="button" className="link" onClick={() => step(null)}>
            Change the number
          </button>
        )}
        {current !== undefined && (
          <button type="button" className="link" disabled={disabled} onClick={onClear}>
            Empty this box
          </button>
        )}
      </div>
    </section>
  );
}
