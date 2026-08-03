import { useState } from 'react';
import type { Player, Turn } from '@shared/games/scrabble/types';

interface Props {
  players: Player[];
  turns: Turn[];
  onUndo: () => void;
  onAdjust: (playerId: string, points: number) => void;
}

const describe = (turn: Turn): JSX.Element => {
  if (turn.kind === 'pass') return <span className="plain">passed</span>;
  if (turn.kind === 'adjust') return <span className="plain">adjustment</span>;
  return <>{turn.words.join(' + ')}{turn.bingo && ' + bingo'}</>;
};

export function HistoryCard({ players, turns, onUndo, onAdjust }: Props) {
  const [playerId, setPlayerId] = useState('');
  const [points, setPoints] = useState('');

  const selected = playerId || players[0]?.id || '';

  function applyAdjustment() {
    const value = Number(points);
    if (!selected || !Number.isFinite(value) || value === 0) return;
    onAdjust(selected, value);
    setPoints('');
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>History</h2>
        {turns.length > 0 && (
          <button type="button" className="link" onClick={onUndo}>Undo last</button>
        )}
      </div>

      <ol className="history">
        {turns.length === 0 && <li className="muted">No turns yet.</li>}
        {[...turns].reverse().map((turn) => (
          <li key={turn.id}>
            <span className="who">{players.find((p) => p.id === turn.playerId)?.name ?? '-'}</span>
            <span className="what">{describe(turn)}</span>
            <span className={`got${turn.points < 0 ? ' neg' : ''}`}>
              {turn.points > 0 ? `+${turn.points}` : turn.points}
            </span>
          </li>
        ))}
      </ol>

      {players.length > 0 && (
        <div className="adjust">
          <span className="muted">End-of-game adjustment</span>
          <select
            value={selected}
            aria-label="Player to adjust"
            onChange={(e) => setPlayerId(e.target.value)}
          >
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            type="number"
            step="1"
            value={points}
            aria-label="Adjustment points"
            placeholder="±pts"
            inputMode="numeric"
            onChange={(e) => setPoints(e.target.value)}
          />
          <button type="button" className="ghost" onClick={applyAdjustment}>Apply</button>
        </div>
      )}
    </section>
  );
}
