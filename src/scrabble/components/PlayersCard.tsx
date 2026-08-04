import { Crown } from 'lucide-react';
import type { Player, Turn } from '@shared/games/scrabble/types';
import { standings } from '@shared/games/scrabble/scoring';
import { PlayersCard as SharedPlayersCard } from '../../shared/PlayersCard';

interface Props {
  players: Player[];
  turns: Turn[];
  currentPlayerId: string | null;
  onAdd: (names: string) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, to: number) => void;
  editable?: boolean;
  /**
   * Whether tapping a row hands them the turn. Only the host may, so for
   * everyone else the rows are plain text rather than dead buttons.
   */
  selectable?: boolean;
  /** The player this device is entering for, marked so it can be picked out. */
  youId?: string | null;
}

export function PlayersCard({
  players, turns, currentPlayerId, onAdd, onRemove, onSelect, onMove,
  editable = true, selectable = true, youId = null,
}: Props) {
  const rows = standings(players, turns);
  const best = rows.length ? Math.max(...rows.map((r) => r.score)) : 0;
  // Somebody leads once a turn has been played, whatever the numbers are. An
  // adjustment can put every total below zero, and there is still a leader.
  const anyPlay = turns.length > 0;

  return (
    <SharedPlayersCard
      players={players}
      onAdd={onAdd}
      onRemove={onRemove}
      onMove={onMove}
      editable={editable}
      reorderable={turns.length === 0}
    >
      <ol className="scoreboard">
        {rows.map((row, i) => {
          const isYou = row.player.id === youId;
          const inside = (
            <>
              <span className="rank">{i + 1}.</span>
              <span className="name">{row.player.name}</span>
              {isYou && <span className="you">you</span>}
              {anyPlay && row.score === best && (
                <span className="leader">
                  <Crown size={13} aria-hidden="true" /> leading
                </span>
              )}
              {row.words > 0 && (
                <span className="avg">
                  {row.words} word{row.words === 1 ? '' : 's'} · avg {row.average}
                </span>
              )}
              <span className={`pts${row.score < 0 ? ' neg' : ''}`}>{row.score}</span>
            </>
          );

          return (
            <li
              key={row.player.id}
              className={[
                row.player.id === currentPlayerId ? 'active' : '',
                isYou ? 'mine' : '',
              ].filter(Boolean).join(' ') || undefined}
            >
              {selectable ? (
                <button
                  type="button"
                  className="scoreboard-row"
                  onClick={() => onSelect(row.player.id)}
                  title={`Make it ${row.player.name}'s turn`}
                >
                  {inside}
                </button>
              ) : (
                <div className="scoreboard-row static">{inside}</div>
              )}
            </li>
          );
        })}
      </ol>
    </SharedPlayersCard>
  );
}
