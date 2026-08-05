import type { BoardState } from '@shared/games/cricket/rules';
import { TARGETS, targetLabel, totalMarks } from '@shared/games/cricket/rules';
import type { Player, Variant } from '@shared/games/cricket/types';
import { MarkGlyph } from './MarkGlyph';

interface Props {
  players: Player[];
  board: BoardState;
  variant: Variant;
  currentPlayerId: string | null;
  onSelect: (id: string) => void;
  /**
   * Whether tapping a column hands over the turn. Only the host may, so for
   * everyone else the headings are plain text: a button that does nothing is
   * worse than no button.
   */
  selectable?: boolean;
  /** The player this device throws for, marked so it can be picked out. */
  youId?: string | null;
}

const FOOTER_LABEL: Record<Variant, string> = {
  standard: 'Points',
  cutthroat: 'Points (low wins)',
  nopoints: 'Marks',
};

export function CricketBoard({
  players,
  board,
  variant,
  currentPlayerId,
  onSelect,
  selectable = true,
  youId = null,
}: Props) {
  if (!players.length) return null;

  return (
    <div className="board-scroll">
      <table className="cricket-board">
        <caption className="sr-only">
          Cricket scoreboard: marks on each target, and points for every player.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="corner">
              Target
            </th>
            {players.map((p) => {
              const inside = (
                <>
                  <span className="name">{p.name}</span>
                  {p.id === youId && <span className="you">you</span>}
                  {board.hasClosedAll[p.id] && <span className="closed-all">closed out</span>}
                </>
              );
              return (
                <th
                  key={p.id}
                  scope="col"
                  className={
                    [p.id === currentPlayerId ? 'active' : '', p.id === youId ? 'mine' : '']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
                  {selectable ? (
                    <button
                      type="button"
                      className="player-head"
                      onClick={() => onSelect(p.id)}
                      title={`Make it ${p.name}'s turn`}
                      aria-label={`Make it ${p.name}'s turn`}
                    >
                      {inside}
                    </button>
                  ) : (
                    <span className="player-head static">{inside}</span>
                  )}
                </th>
              );
            })}
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
