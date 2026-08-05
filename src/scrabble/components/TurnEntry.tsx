import { useState, type FormEvent } from 'react';
import { BookOpen, Plus, X } from 'lucide-react';
import type { Draft, Player, Tile, WordMult } from '@shared/games/scrabble/types';
import {
  WORD_MULTS,
  cycleTile,
  draftWord,
  draftWordScore,
  emptyDraft,
  tilesFromWord,
  turnTotal,
} from '@shared/games/scrabble/scoring';
import { WhoseTurn, turnTone } from '../../rooms/WhoseTurn';
import { runLookup, type LookupView } from '../lib/lookupView';
import { TileRow } from './TileRow';
import { ValidityBar } from './ValidityBar';

interface Props {
  draft: Draft;
  setDraft: (update: (d: Draft) => Draft) => void;
  currentPlayer: Player | null;
  turnNumber: number;
  onScore: () => void;
  onPass: () => void;
  onOpenDictionary: () => void;
  /** In a room, closed off until it is your turn. */
  disabled?: boolean;
  /**
   * Whether the turn on the board is this device's, or null when playing alone
   * and the question does not arise. Worth saying outright: at a table everyone
   * is looking at their own phone, and "Now playing: Ada" makes you work out
   * whether Ada is you.
   */
  yourTurn?: boolean | null;
}

const IDLE: LookupView = { kind: 'idle' };

export function TurnEntry({
  draft,
  setDraft,
  currentPlayer,
  turnNumber,
  onScore,
  onPass,
  onOpenDictionary,
  disabled = false,
  yourTurn = null,
}: Props) {
  const [check, setCheck] = useState<LookupView>(IDLE);
  const word = draftWord(draft);

  const tone = turnTone(currentPlayer?.name ?? null, yourTurn);

  const patch = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));

  function handleType(raw: string) {
    setCheck(IDLE);
    setDraft((d) => ({ ...d, tiles: tilesFromWord(raw, d.tiles) }));
  }

  function setTile(index: number, changes: Partial<Tile>) {
    setDraft((d) => ({
      ...d,
      tiles: d.tiles.map((t, i) => (i === index ? { ...t, ...changes } : t)),
    }));
  }

  /** Move the word in the box into this turn's list, for plays forming several words. */
  function bankWord() {
    setCheck(IDLE);
    setDraft((d) => {
      if (!d.tiles.length) return d;
      return {
        ...d,
        words: [...d.words, { word: draftWord(d), points: draftWordScore(d) }],
        tiles: [],
        wordMult: 1,
      };
    });
  }

  async function runCheck() {
    if (word.length < 2) {
      setCheck({ kind: 'error', word, message: 'Type a word of two or more letters first.' });
      return;
    }
    setCheck({ kind: 'loading', word });
    try {
      setCheck(await runLookup(word));
    } catch {
      // Aborted lookups are superseded by whatever triggered the abort.
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onScore();
    setCheck(IDLE);
  }

  return (
    <section className={`card${tone ? ` entry ${tone}` : ''}`}>
      <div className="card-head">
        <h2>
          Turn <span className="muted">#{turnNumber}</span>
        </h2>
        <WhoseTurn
          name={currentPlayer?.name ?? null}
          yours={yourTurn}
          nowPlaying="Now playing"
          yoursLabel="Your turn"
          empty="Add a player to start scoring"
        />
      </div>

      <form onSubmit={submit}>
        <div className="row">
          <input
            type="text"
            value={word}
            onChange={(e) => handleType(e.target.value)}
            placeholder="Type the word played…"
            aria-label="Word played"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={15}
          />
          <button type="button" className="ghost" onClick={() => void runCheck()}>
            Check
          </button>
        </div>

        <ValidityBar view={check} />

        <TileRow
          tiles={draft.tiles}
          onCycle={(i) => setTile(i, cycleTile(draft.tiles[i]!))}
          onSet={setTile}
        />

        <div className="bonus-row">
          <div className="seg" role="group" aria-label="Word multiplier">
            <span className="seg-label">Word</span>
            {WORD_MULTS.map((m) => (
              <button
                key={m}
                type="button"
                className={draft.wordMult === m ? 'on' : undefined}
                aria-pressed={draft.wordMult === m}
                onClick={() => patch({ wordMult: m as WordMult })}
              >
                ×{m}
              </button>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.bingo}
              onChange={(e) => patch({ bingo: e.target.checked })}
            />
            Bingo <span className="muted">+50</span>
          </label>
        </div>

        {draft.words.length > 0 && (
          <ul className="pending">
            {draft.words.map((w, i) => (
              <li key={`${w.word}-${i}`}>
                <span className="w">{w.word}</span>
                <span className="p">{w.points} pts</span>
                <button
                  type="button"
                  aria-label={`Remove ${w.word}`}
                  onClick={() =>
                    setDraft((d) => ({ ...d, words: d.words.filter((_, j) => j !== i) }))
                  }
                >
                  <X size={14} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="total-row">
          <div className="total">
            <span className="muted">Turn total</span>
            <strong data-testid="turn-total">{turnTotal(draft)}</strong>
          </div>
          <div className="total-actions">
            <button type="button" className="ghost" onClick={onOpenDictionary}>
              <BookOpen size={15} aria-hidden="true" /> Dictionary
            </button>
            <button type="button" className="ghost" onClick={bankWord}>
              <Plus size={15} aria-hidden="true" /> Another word
            </button>
            <button
              type="button"
              className="ghost"
              disabled={disabled}
              onClick={() => {
                onPass();
                setCheck(IDLE);
              }}
            >
              Pass
            </button>
            <button type="submit" className="primary" disabled={!currentPlayer || disabled}>
              Score turn
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

export { emptyDraft };
