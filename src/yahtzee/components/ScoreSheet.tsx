import {
  HINTS,
  LABELS,
  LOWER,
  UPPER,
  UPPER_BONUS,
  UPPER_TARGET,
} from '@shared/games/yahtzee/rules';
import type { Sheet } from '@shared/games/yahtzee/rules';
import type { Category, Player } from '@shared/games/yahtzee/types';

/** The box being filled in. `yahtzeeBonus` is the tick row, not a real box. */
export type Selection = { playerId: string; category: Category | 'yahtzeeBonus' };

interface Props {
  players: Player[];
  sheets: Record<string, Sheet>;
  currentPlayerId: string | null;
  selected: Selection | null;
  onPick: (selection: Selection) => void;
  /** Handing the turn over by tapping a column heading. Host only. */
  onSelectPlayer: (playerId: string) => void;
  /**
   * Whether tapping a column heading hands the turn over. Only the host may, so
   * for everyone else the headings are plain text: a button that only ever
   * refuses is worse than no button.
   */
  selectable?: boolean;
  /**
   * Whose sheet this device may write on. The host may write on anyone's; a
   * player only on their own; a watcher on nobody, and sees plain numbers.
   */
  canFill: (playerId: string) => boolean;
  /** True while the room would turn an entry down, so boxes wait rather than lie. */
  waiting?: boolean;
  /** The player this device scores for, marked so it can be picked out. */
  youId?: string | null;
}

const same = (a: Selection | null, playerId: string, category: Selection['category']) =>
  a?.playerId === playerId && a.category === category;

export function ScoreSheet({
  players,
  sheets,
  currentPlayerId,
  selected,
  onPick,
  onSelectPlayer,
  selectable = true,
  canFill,
  waiting = false,
  youId = null,
}: Props) {
  if (!players.length) return null;

  const columnClass = (id: string) =>
    [id === currentPlayerId ? 'active' : '', id === youId ? 'mine' : '']
      .filter(Boolean)
      .join(' ') || undefined;

  /** One box on one sheet: a button where it can be written in, text where not. */
  const box = (player: Player, category: Category) => {
    const sheet = sheets[player.id];
    const value = sheet?.scores[category];
    const filled = value !== undefined;

    if (!canFill(player.id)) {
      return (
        <td key={player.id} className={columnClass(player.id)}>
          <span className="box static">{filled ? value : ''}</span>
        </td>
      );
    }

    return (
      <td key={player.id} className={columnClass(player.id)}>
        <button
          type="button"
          className={`box${filled ? ' filled' : ' empty'}`}
          aria-label={
            filled
              ? `Change ${LABELS[category]} for ${player.name}, now ${value}`
              : `Score ${LABELS[category]} for ${player.name}`
          }
          aria-pressed={same(selected, player.id, category)}
          disabled={waiting}
          onClick={() => onPick({ playerId: player.id, category })}
        >
          {filled ? value : ''}
        </button>
      </td>
    );
  };

  /** A figure nobody enters: it is added up from the boxes above it. */
  const derived = (player: Player, value: number, extra?: string) => (
    <td key={player.id} className={columnClass(player.id)}>
      <span className="box static derived">{value}</span>
      {extra && <span className="note">{extra}</span>}
    </td>
  );

  const row = (category: Category) => (
    <tr key={category}>
      <th scope="row">
        {LABELS[category]}
        <span className="how">{HINTS[category]}</span>
      </th>
      {players.map((p) => box(p, category))}
    </tr>
  );

  return (
    <div className="board-scroll">
      <table className="score-sheet">
        <caption className="sr-only">
          Yahtzee score sheet: every box, and the totals, for every player.
        </caption>

        <thead>
          <tr>
            <th scope="col" className="corner">
              Upper section
            </th>
            {players.map((p) => {
              const inside = (
                <>
                  <span className="name">{p.name}</span>
                  {p.id === youId && <span className="you">you</span>}
                </>
              );
              return (
                <th key={p.id} scope="col" className={columnClass(p.id)}>
                  {selectable ? (
                    <button
                      type="button"
                      className="player-head"
                      onClick={() => onSelectPlayer(p.id)}
                      aria-label={`Make it ${p.name}'s turn`}
                      title={`Make it ${p.name}'s turn`}
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
          {UPPER.map(row)}
          <tr className="sub">
            <th scope="row">Upper total</th>
            {players.map((p) => derived(p, sheets[p.id]?.upper ?? 0))}
          </tr>
          <tr className="sub">
            <th scope="row">
              Bonus
              <span className="how">
                {UPPER_TARGET} or more scores {UPPER_BONUS}
              </span>
            </th>
            {players.map((p) => {
              const sheet = sheets[p.id];
              const toTarget = sheet?.toTarget ?? UPPER_TARGET;
              return derived(
                p,
                sheet?.upperBonus ?? 0,
                toTarget > 0 ? `${toTarget} to go` : undefined,
              );
            })}
          </tr>
        </tbody>

        <tbody>
          <tr className="section">
            <th scope="colgroup" colSpan={players.length + 1}>
              Lower section
            </th>
          </tr>
          {LOWER.map(row)}
          <tr>
            <th scope="row">
              Yahtzee bonus
              <span className="how">Each extra Yahtzee scores 100</span>
            </th>
            {players.map((p) => {
              const sheet = sheets[p.id];
              const claimable = sheet?.canClaimBonus ?? false;
              const points = sheet?.bonusPoints ?? 0;
              const count = sheet?.extraYahtzees ?? 0;

              if (!canFill(p.id)) {
                return (
                  <td key={p.id} className={columnClass(p.id)}>
                    <span className="box static">{claimable ? points : ''}</span>
                  </td>
                );
              }

              return (
                <td key={p.id} className={columnClass(p.id)}>
                  <button
                    type="button"
                    className={`box${count ? ' filled' : ' empty'}`}
                    aria-label={
                      count
                        ? `Change extra Yahtzees for ${p.name}, now ${count}`
                        : `Add an extra Yahtzee for ${p.name}`
                    }
                    aria-pressed={same(selected, p.id, 'yahtzeeBonus')}
                    disabled={waiting || !claimable}
                    title={claimable ? undefined : 'Score the Yahtzee box first'}
                    onClick={() => onPick({ playerId: p.id, category: 'yahtzeeBonus' })}
                  >
                    {count ? points : ''}
                  </button>
                </td>
              );
            })}
          </tr>
        </tbody>

        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {players.map((p) => {
              const sheet = sheets[p.id];
              return (
                <td key={p.id} className={columnClass(p.id)}>
                  <span className="pts">{sheet?.total ?? 0}</span>
                  <span className="note">
                    {!sheet || sheet.remaining === 0
                      ? 'sheet full'
                      : `${sheet.remaining} box${sheet.remaining === 1 ? '' : 'es'} left`}
                  </span>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
