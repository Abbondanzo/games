import { Delete } from 'lucide-react';
import { JOKER_PENALTY, TILE_VALUES } from '@shared/games/rummikub/rules';

interface Props {
  onAdd: (value: number) => void;
  onUndo: () => void;
  canUndo: boolean;
  disabled?: boolean;
}

/**
 * The tile keypad, shared by the host entering everyone's racks and by a player
 * entering only their own, so the two cannot end up disagreeing about what a
 * joker costs.
 */
export function TileButtons({ onAdd, onUndo, canUndo, disabled = false }: Props) {
  return (
    <div className="tile-pad" role="group" aria-label="Tile values">
      {TILE_VALUES.map((v) => (
        <button key={v} type="button" onClick={() => onAdd(v)} disabled={disabled}>
          {v}
        </button>
      ))}
      <button
        type="button"
        className="joker"
        onClick={() => onAdd(JOKER_PENALTY)}
        disabled={disabled}
        title="A joker left on the rack costs 30"
      >
        Joker
      </button>
      <button
        type="button"
        className="undo"
        onClick={onUndo}
        disabled={disabled || !canUndo}
        aria-label="Remove last tile"
      >
        <Delete size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
