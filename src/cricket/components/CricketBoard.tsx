import type { BoardState } from '../lib/cricket';
import { TARGETS, targetLabel } from '../lib/cricket';
import type { Player, Variant } from '../lib/types';
import { MarkGlyph } from './MarkGlyph';

interface Props {
  players: Player[];
  board: BoardState;
  variant: Variant;
  currentPlayerId: string | null;
  onSelect: (id: string) => void;
}

const FOOTER_LABEL: Record<Variant, string> = {
  standard: 'Points',
  cutthroat: 'Points (low wins)',
  nopoints: 'Marks',
};

const totalMarks = (board: BoardState, playerId: string): number =>
  TARGETS.reduce((sum, t) => sum + (board.marks[playerId]?.[t] ?? 0), 0);

export function CricketBoard({ players, board, variant, currentPlayerId, onSelect }: Props) {
  if (!players.length) return null;

  return (
    <div className="board-scroll">
      <table className="cricket-board">
        <caption className="sr-only">
          Cricket scoreboard: marks on each target, and points for every player.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="corner">Target</th>
            {players.map((p) => (
              <th
                key={p.id}
                scope="col"
                className={p.id === currentPlayerId ? 'active' : undefined}
              >
                <button
                  type="button"
                  className="player-head"
                  onClick={() => onSelect(p.id)}
                  title={`Make it ${p.name}'s turn`}
                >
                  <span className="name">{p.name}</span>
                  {board.hasClosedAll[p.id] && <span className="closed-all">closed out</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {TARGETS.map((target) => (
            <tr key={target} className={board.dead[target] ? 'dead' : undefined}>
              <th scope="row">
                {targetLabel(target)}
                {board.dead[target] && <span className="dead-tag">dead</span>}
              </th>
              {players.map((p) => (
                <td key={p.id} className={p.id === currentPlayerId ? 'active' : undefined}>
                  <MarkGlyph marks={board.marks[p.id]?.[target] ?? 0} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <th scope="row">{FOOTER_LABEL[variant]}</th>
            {players.map((p) => (
              <td key={p.id} className={p.id === currentPlayerId ? 'active' : undefined}>
                <span className="pts">
                  {variant === 'nopoints' ? totalMarks(board, p.id) : (board.points[p.id] ?? 0)}
                </span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
