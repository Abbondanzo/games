import { Crown } from 'lucide-react';
import type { Player, Turn } from '../lib/types';
import { standings } from '../lib/scoring';
import { PlayersCard as SharedPlayersCard } from '../../shared/PlayersCard';

interface Props {
  players: Player[];
  turns: Turn[];
  currentPlayerId: string | null;
  onAdd: (names: string) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}

export function PlayersCard({ players, turns, currentPlayerId, onAdd, onRemove, onSelect }: Props) {
  const rows = standings(players, turns);
  const best = rows.length ? Math.max(...rows.map((r) => r.score)) : 0;

  return (
    <SharedPlayersCard players={players} onAdd={onAdd} onRemove={onRemove}>
      <ol className="scoreboard">
        {rows.map((row, i) => (
          <li
            key={row.player.id}
            className={row.player.id === currentPlayerId ? 'active' : undefined}
          >
            <button
              type="button"
              className="scoreboard-row"
              onClick={() => onSelect(row.player.id)}
              title={`Make it ${row.player.name}'s turn`}
            >
              <span className="rank">{i + 1}.</span>
              <span className="name">{row.player.name}</span>
              {best > 0 && row.score === best && (
                <span className="leader">
                  <Crown size={13} aria-hidden="true" /> leading
                </span>
              )}
              {row.words > 0 && (
                <span className="avg">
                  {row.words} word{row.words === 1 ? '' : 's'} · avg {row.average}
                </span>
              )}
              <span className="pts">{row.score}</span>
            </button>
          </li>
        ))}
      </ol>
    </SharedPlayersCard>
  );
}
