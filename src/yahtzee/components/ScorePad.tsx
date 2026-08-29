import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  DICE,
  FACES,
  faceOf,
  HINTS,
  isUpper,
  kindOf,
  kindTotals,
  LABELS,
  scoreOptions,
  spareDice,
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

/** How many dice showed the one face, which is what an upper box is asked. */
const COUNTS = Array.from({ length: DICE }, (_, i) => i + 1);

const NUMBER_WORD = ['one', 'two', 'three', 'four', 'five', 'six'];

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
 * No box is ever asked for a total, because the total is the one thing nobody
 * at the table has said out loud. Every pad asks for what was rolled, and works
 * the number out: an upper box asks how many of its face you got, the two
 * of-a-kind boxes ask which number you got four of and then what the other dice
 * were, and chance asks for all five. Only the fixed combinations are a single
 * number, and they are the same number every time.
 *
 * A turn that scored nothing is still two taps, which is the point - it is the
 * commonest entry of the game and the easiest one to leave out.
 *
 * That is not politeness, it is what makes an entry safe. Four fives cannot
 * come to 7, but "any total from 5 to 30" cannot say so, because taken on its
 * own every one of those totals is some four of a kind. Only the matched face
 * rules the rest of them out. Chance has nothing to match, so nothing can be
 * ruled out at all: there the safety is that a hand of 6 4 4 3 2 goes in as it
 * lies, and adding it up in your head first is the step that gets it wrong.
 *
 * Wherever dice are tapped in, each key carries what the hand comes to with
 * that die in it, so the tap that writes the box writes a number that was on
 * screen before it was taken.
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
    setDice([]);
    setFace(to);
  };
  useEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    pad.current?.querySelector('button')?.focus();
  }, [face]);

  /**
   * Taking a die back removes the button the caret is on, so it is moved to the
   * pad first. Tapping one in does not need this: the keys are never replaced
   * there, only relabelled.
   */
  const takeBack = (at: number) => {
    pad.current?.querySelector('button')?.focus();
    setDice(dice.filter((_, i) => i !== at));
  };

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

  /**
   * The dice tapped in one at a time, for the boxes that add them up.
   *
   * `base` is what the box has accounted for already - nothing for chance, the
   * matched dice for an of-a-kind box - and `want` is how many are left to tap.
   * Only the last key writes anything, so only it names the total; the others
   * carry what the hand stands at with that die in it.
   */
  const diceKeys = (base: number, want: number) => {
    const last = dice.length === want - 1;
    return DIE_FACES.map((value) => {
      const total = base + running + value;
      // The first die of a chance hand has no total behind it yet to show.
      const bare = base + running === 0;

      return (
        <button
          key={value}
          type="button"
          className={`key${bare ? '' : ' tall'}`}
          aria-label={last ? `Die showing ${value}, scores ${total}` : `Die showing ${value}`}
          disabled={disabled}
          onClick={() => (last ? onScore(total) : setDice([...dice, value]))}
        >
          {bare ? (
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
  };

  /* ── the five shapes the keys take ── */

  let hint: string;
  let groupLabel: string;
  let keys: JSX.Element[];
  /** The dice the box has matched already, or null where none are shown. */
  let matched: number[] | null = null;

  if (category === 'chance') {
    matched = [];
    hint =
      dice.length === 0
        ? 'Tap each of your five dice.'
        : `${MORE[DICE - dice.length]} ${running} so far.`;
    groupLabel = `The ${ORDINALS[dice.length]} die`;
    keys = diceKeys(0, DICE);
  } else if (isUpper(category)) {
    const each = faceOf(category);
    const many = LABELS[category].toLowerCase();
    hint = `How many ${many} did you get?`;
    groupLabel = `How many ${many}`;
    keys = COUNTS.map((count) =>
      keyFor(
        count * each,
        count,
        String(count * each),
        `${count} ${count === 1 ? NUMBER_WORD[each - 1] : many}, total ${count * each}`,
      ),
    );
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
    matched = Array.from({ length: kind }, () => face);
    const said = `${COUNT_WORD[kind]} ${face}s`;
    hint =
      dice.length > 0
        ? `${MORE[spare - dice.length]} ${kind * face + running} so far.`
        : spare === 1
          ? `${said}. What was the other die?`
          : `${said}. What were the other two dice?`;
    hint = hint.charAt(0).toUpperCase() + hint.slice(1);
    groupLabel =
      spare === 1
        ? 'The other die'
        : dice.length === 0
          ? 'The first of the other two dice'
          : 'The last of the other two dice';
    keys = diceKeys(kind * face, spare);
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

      {matched !== null && (
        <div className="dice-run">
          {matched.map((value, at) => (
            <span key={`set-${at}`} className="die set" aria-hidden="true">
              {value}
            </span>
          ))}
          {dice.map((value, at) => (
            <button
              key={at}
              type="button"
              className="die"
              aria-label={`Take back the ${ORDINALS[matched.length + at]} die, showing ${value}`}
              disabled={disabled}
              onClick={() => takeBack(at)}
            >
              {value}
            </button>
          ))}
          {Array.from({ length: DICE - matched.length - dice.length }, (_, at) => (
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
