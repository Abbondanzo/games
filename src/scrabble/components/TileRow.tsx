import type { KeyboardEvent } from 'react';
import type { LetterMult, Tile } from '../lib/types';
import { tileValue } from '../lib/scoring';

interface Props {
  tiles: Tile[];
  onCycle: (index: number) => void;
  onSet: (index: number, patch: Partial<Tile>) => void;
}

const bonusLabel = (t: Tile): string => (t.blank ? 'BL' : t.lm === 2 ? 'DL' : t.lm === 3 ? 'TL' : '');

const bonusClass = (t: Tile): string => (t.blank ? 'bl' : t.lm === 2 ? 'dl' : t.lm === 3 ? 'tl' : '');

const describe = (t: Tile): string => {
  const worth = t.blank ? 'blank tile, 0 points' : `${tileValue(t)} points`;
  const bonus = t.lm > 1 ? `, ${t.lm}× letter score` : '';
  return `${t.ch}, ${worth}${bonus}. Press to change the bonus square.`;
};

export function TileRow({ tiles, onCycle, onSet }: Props) {
  if (!tiles.length) return null;

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number, tile: Tile) {
    const key = event.key.toLowerCase();
    if (key === '1' || key === '2' || key === '3') {
      onSet(index, { lm: Number(key) as LetterMult, blank: false });
    } else if (key === 'b') {
      onSet(index, { blank: !tile.blank, lm: tile.blank ? tile.lm : 1 });
    } else {
      return;
    }
    event.preventDefault();
  }

  return (
    <>
      <div className="tiles" role="group" aria-label="Letters played">
        {tiles.map((tile, i) => (
          <button
            // Tiles are positional: index is the identity here.
            key={i}
            type="button"
            className={`tile ${bonusClass(tile)}`.trim()}
            aria-label={describe(tile)}
            onClick={() => onCycle(i)}
            onKeyDown={(e) => handleKey(e, i, tile)}
          >
            {tile.ch}
            <span className="tag" aria-hidden="true">{bonusLabel(tile)}</span>
            <span className="val" aria-hidden="true">{tileValue(tile) * tile.lm}</span>
          </button>
        ))}
      </div>
      <p className="hint">
        Tap a letter to cycle <b className="k dl">DL</b> → <b className="k tl">TL</b> →{' '}
        <b className="k bl">blank</b>. With a letter focused, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>{' '}
        set the multiplier and <kbd>B</kbd> toggles blank.
      </p>
    </>
  );
}
