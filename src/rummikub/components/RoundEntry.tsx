import { useEffect, useState } from 'react';
import { Delete, Trophy } from 'lucide-react';
import type { Player } from '../lib/types';
import { JOKER_PENALTY, TILE_VALUES, potFor } from '../lib/rummikub';

interface Props {
  players: Player[];
  roundNumber: number;
  onScore: (winnerId: string, penalties: Record<string, number>) => void;
}

/** Taps are kept per player so the last one can be undone; the total is their sum. */
type Taps = Record<string, number[]>;

const total = (taps: number[] | undefined): number => (taps ?? []).reduce((a, b) => a + b, 0);

export function RoundEntry({ players, roundNumber, onScore }: Props) {
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [taps, setTaps] = useState<Taps>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const losers = players.filter((p) => p.id !== winnerId);

  // Keep the keypad pointed at a player who is actually still being scored.
  useEffect(() => {
    if (focusedId && losers.some((p) => p.id === focusedId)) return;
    setFocusedId(losers[0]?.id ?? null);
  }, [losers, focusedId]);

  const penalties = Object.fromEntries(losers.map((p) => [p.id, total(taps[p.id])]));
  const pot = winnerId ? potFor(penalties, players, winnerId) : 0;

  const addTile = (value: number) => {
    if (!focusedId) return;
    setTaps((t) => ({ ...t, [focusedId]: [...(t[focusedId] ?? []), value] }));
  };

  const undoTile = () => {
    if (!focusedId) return;
    setTaps((t) => ({ ...t, [focusedId]: (t[focusedId] ?? []).slice(0, -1) }));
  };

  /** Typing a total replaces the tally rather than fighting with it. */
  const setTotal = (id: string, raw: string) => {
    const value = Number.parseInt(raw, 10);
    setTaps((t) => ({ ...t, [id]: Number.isFinite(value) && value > 0 ? [value] : [] }));
  };

  function submit() {
    if (!winnerId) return;
    onScore(winnerId, penalties);
    setWinnerId(null);
    setTaps({});
    setFocusedId(null);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Round <span className="muted">#{roundNumber}</span></h2>
      </div>

      {players.length < 2 ? (
        <p className="muted">Add at least two players to score a round.</p>
      ) : (
        <>
          <fieldset className="winner-pick">
            <legend>Who went out?</legend>
            <div className="seg wrap">
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={winnerId === p.id ? 'on' : undefined}
                  aria-pressed={winnerId === p.id}
                  onClick={() => setWinnerId(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </fieldset>

          {winnerId && (
            <>
              <p className="hint">
                Tiles left on each rack. Tap a player, then tap the tiles they were holding, or
                just type the total.
              </p>

              <ul className="rack-list">
                {losers.map((p) => (
                  <li key={p.id} className={p.id === focusedId ? 'focused' : undefined}>
                    <button
                      type="button"
                      className="rack-name"
                      onClick={() => setFocusedId(p.id)}
                      aria-pressed={p.id === focusedId}
                      aria-label={`Enter tiles for ${p.name}`}
                    >
                      {p.name}
                    </button>
                    <span className="rack-tiles">
                      {(taps[p.id] ?? []).map((v, i) => (
                        <span key={i} className={`rack-tile${v === JOKER_PENALTY ? ' joker' : ''}`}>
                          {v === JOKER_PENALTY ? 'J' : v}
                        </span>
                      ))}
                    </span>
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      className="rack-total"
                      aria-label={`Tiles left for ${p.name}`}
                      value={total(taps[p.id]) || ''}
                      placeholder="0"
                      onFocus={() => setFocusedId(p.id)}
                      onChange={(e) => setTotal(p.id, e.target.value)}
                    />
                  </li>
                ))}
              </ul>

              <div className="tile-pad" role="group" aria-label="Tile values">
                {TILE_VALUES.map((v) => (
                  <button key={v} type="button" onClick={() => addTile(v)} disabled={!focusedId}>
                    {v}
                  </button>
                ))}
                <button
                  type="button"
                  className="joker"
                  onClick={() => addTile(JOKER_PENALTY)}
                  disabled={!focusedId}
                  title="A joker left on the rack costs 30"
                >
                  Joker
                </button>
                <button
                  type="button"
                  className="undo"
                  onClick={undoTile}
                  disabled={!focusedId || !(taps[focusedId] ?? []).length}
                  aria-label="Remove last tile"
                >
                  <Delete size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="total-row">
                <div className="total">
                  <Trophy size={16} aria-hidden="true" className="mark" />
                  <span className="muted">
                    {players.find((p) => p.id === winnerId)?.name} scores
                  </span>
                  <strong data-testid="round-pot">+{pot}</strong>
                </div>
                <div className="total-actions">
                  <button type="button" className="primary" onClick={submit}>Score round</button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
