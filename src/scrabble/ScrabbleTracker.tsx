import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, RotateCcw, Trash2 } from 'lucide-react';
import { PlayersCard } from './components/PlayersCard';
import { TurnEntry } from './components/TurnEntry';
import { HistoryCard } from './components/HistoryCard';
import { DictionaryDrawer } from './components/DictionaryDrawer';
import { useGame } from './lib/useGame';
import { draftWord, draftWordScore, emptyDraft } from '@shared/games/scrabble/scoring';
import type { Draft } from '@shared/games/scrabble/types';

export function ScrabbleTracker() {
  const { state, dispatch } = useGame();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dictOpen, setDictOpen] = useState(false);

  const currentPlayer = state.players[state.currentIndex] ?? null;
  const turnNumber = state.turns.filter((t) => t.kind !== 'adjust').length + 1;

  function scoreTurn() {
    // Whatever is still in the entry box counts as part of this turn.
    const pending = draft.tiles.length
      ? [...draft.words, { word: draftWord(draft), points: draftWordScore(draft) }]
      : draft.words;
    // A bingo on its own is not a turn; there has to be a word.
    if (!pending.length) return;

    dispatch({ type: 'recordPlay', words: pending, bingo: draft.bingo });
    setDraft(emptyDraft());
  }

  function pass() {
    dispatch({ type: 'pass' });
    setDraft(emptyDraft());
  }

  function resetAll() {
    if (!window.confirm('Reset everything? Scores, history and player names are all cleared.')) return;
    dispatch({ type: 'resetAll' });
    setDraft(emptyDraft());
  }

  function newGame() {
    if (!window.confirm('Start a new game? Scores and history will be cleared. Players are kept.')) return;
    dispatch({ type: 'newGame' });
    setDraft(emptyDraft());
  }

  return (
    <>
      <header className="topbar">
        <Link className="back" to="/" aria-label="All games">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <h1>Scrabble</h1>
        <div className="topbar-actions">
          <button type="button" className="ghost" onClick={() => setDictOpen(true)}>
            <BookOpen size={15} aria-hidden="true" /> Dictionary
          </button>
          <button
            type="button"
            className="ghost"
            onClick={newGame}
            title="Clear the scores and keep the players"
          >
            <RotateCcw size={15} aria-hidden="true" /> New game
          </button>
          <button
            type="button"
            className="ghost danger"
            onClick={resetAll}
            title="Clear the scores and the players"
          >
            <Trash2 size={15} aria-hidden="true" /> Reset all
          </button>
        </div>
      </header>

      <main>
        <PlayersCard
          players={state.players}
          turns={state.turns}
          currentPlayerId={currentPlayer?.id ?? null}
          onAdd={(names) => dispatch({ type: 'addPlayers', names })}
          onRemove={(id) => dispatch({ type: 'removePlayer', id })}
          onSelect={(id) => dispatch({ type: 'setCurrent', id })}
        />

        <TurnEntry
          draft={draft}
          setDraft={setDraft}
          currentPlayer={currentPlayer}
          turnNumber={turnNumber}
          onScore={scoreTurn}
          onPass={pass}
          onOpenDictionary={() => setDictOpen(true)}
        />

        <HistoryCard
          players={state.players}
          turns={state.turns}
          onUndo={() => dispatch({ type: 'undo' })}
          onAdjust={(playerId, points) => dispatch({ type: 'adjust', playerId, points })}
        />
      </main>

      {dictOpen && (
        <DictionaryDrawer initialWord={draftWord(draft)} onClose={() => setDictOpen(false)} />
      )}
    </>
  );
}
