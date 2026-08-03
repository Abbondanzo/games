import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { BoardState } from '../lib/cricket';
import { DARTS_PER_TURN, TARGETS, dartShorthand, targetLabel } from '../lib/cricket';
import type { CricketTarget, Dart, Player } from '../lib/types';
import { MarkGlyph } from './MarkGlyph';

interface Props {
  currentPlayer: Player | null;
  board: BoardState;
  /** Marks and points the darts held so far would add. */
  preview: { marks: number; points: number };
  darts: Dart[];
  onChangeDarts: (darts: Dart[]) => void;
  onRecord: (darts: Dart[]) => void;
  onUndo: () => void;
  canUndo: boolean;
  disabled: boolean;
}

type Ring = 1 | 2 | 3;

const RINGS: { value: Ring; label: string; short: string }[] = [
  { value: 1, label: 'Single', short: 'S' },
  { value: 2, label: 'Double', short: 'D' },
  { value: 3, label: 'Triple', short: 'T' },
];

export function DartEntry({
  currentPlayer, board, preview, darts, onChangeDarts, onRecord, onUndo, canUndo, disabled,
}: Props) {
  const [ring, setRing] = useState<Ring>(1);

  function throwDart(target: CricketTarget | 0) {
    // The bull has no triple ring, so a bull thrown on "Triple" is an inner bull.
    const multiplier = target === 25 && ring === 3 ? 2 : ring;
    const next = [...darts, { target, multiplier: target === 0 ? 1 : multiplier } as Dart];

    if (next.length >= DARTS_PER_TURN) {
      onRecord(next);
      onChangeDarts([]);
      setRing(1);
    } else {
      onChangeDarts(next);
    }
  }

  function endTurnEarly() {
    if (darts.length) onRecord(darts);
    onChangeDarts([]);
    setRing(1);
  }

  const slots = Array.from({ length: DARTS_PER_TURN }, (_, i) => darts[i]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Throw</h2>
        <div className="whose-turn">
          {currentPlayer
            ? <>Now throwing: <b>{currentPlayer.name}</b></>
            : 'Add a player to start scoring'}
        </div>
      </div>

      <div className="seg ring-seg" role="group" aria-label="Ring">
        {RINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            className={ring === r.value ? 'on' : undefined}
            aria-pressed={ring === r.value}
            onClick={() => setRing(r.value)}
            disabled={disabled}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="target-grid">
        {TARGETS.map((target) => {
          const marks = currentPlayer ? (board.marks[currentPlayer.id]?.[target] ?? 0) : 0;
          const dead = board.dead[target] ?? false;
          return (
            <button
              key={target}
              type="button"
              className={`target${dead ? ' dead' : ''}${marks >= 3 ? ' closed' : ''}`}
              onClick={() => throwDart(target)}
              disabled={disabled || !currentPlayer}
              aria-label={`${ring === 3 && target === 25 ? 'Double' : RINGS[ring - 1]!.label} ${targetLabel(target)}`}
            >
              <span className="num">{targetLabel(target)}</span>
              <MarkGlyph marks={marks} />
            </button>
          );
        })}
        <button
          type="button"
          className="target miss"
          onClick={() => throwDart(0)}
          disabled={disabled || !currentPlayer}
        >
          <span className="num">Miss</span>
        </button>
      </div>

      <div className="throw-row">
        <ul className="dart-slots" aria-label="Darts this turn">
          {slots.map((dart, i) => (
            <li key={i} className={dart ? 'filled' : 'empty'}>
              {dart ? (
                <button
                  type="button"
                  className="dart-chip"
                  aria-label={`Remove dart ${i + 1}, ${dartShorthand(dart)}`}
                  onClick={() => onChangeDarts(darts.filter((_, j) => j !== i))}
                >
                  {dartShorthand(dart)}
                </button>
              ) : (
                <span className="dart-chip empty" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>

        <div className="throw-preview" data-testid="throw-preview">
          <span className="muted">This throw</span>
          <strong>
            {preview.marks} mark{preview.marks === 1 ? '' : 's'}
            {preview.points > 0 && ` · ${preview.points} pts`}
          </strong>
        </div>

        <div className="throw-actions">
          <button type="button" className="ghost" onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={15} aria-hidden="true" /> Undo turn
          </button>
          <button
            type="button"
            className="primary"
            onClick={endTurnEarly}
            disabled={disabled || !darts.length}
          >
            End turn
          </button>
        </div>
      </div>

      <p className="hint">
        Pick a ring, then tap where the dart landed - the turn passes on automatically after
        three darts. A triple on the bull counts as the inner bull.
      </p>
    </section>
  );
}
