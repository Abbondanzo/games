import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { PlayersCard } from './components/PlayersCard';
import { TurnEntry } from './components/TurnEntry';
import { HistoryCard } from './components/HistoryCard';
import { DictionaryDrawer } from './components/DictionaryDrawer';
import { useGame } from './lib/useGame';
import { RoomStrip } from '../rooms/RoomStrip';
import { TopBar } from '../shared/TopBar';
import { allowed, blocked, isHost as amHost, isMyTurn } from '../rooms/whoAmI';
import { summarise } from '../rooms/describeGame';
import { HostRoomButton } from '../rooms/HostRoomButton';
import { draftWord, draftWordScore, emptyDraft } from '@shared/games/scrabble/scoring';
import type { Draft } from '@shared/games/scrabble/types';

const describeGame = (s: { players: unknown[]; turns: unknown[] }) =>
  summarise([
    [s.players.length, 'player'],
    [s.turns.length, 'turn'],
  ]);

export function ScrabbleTracker() {
  const { state, dispatch, room, onReject, gone } = useGame();

  // A refused play would otherwise take the typed word with it.
  onReject((action) => {
    if (action.type === 'recordPlay') {
      setDraft((d) => ({ ...d, words: action.words, bingo: action.bingo }));
    }
  });

  const isHost = amHost(room);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dictOpen, setDictOpen] = useState(false);

  const currentPlayer = state.players[state.currentIndex] ?? null;
  const turnNumber = state.turns.filter((t) => t.kind !== 'adjust').length + 1;

  const yourTurn = isMyTurn(room, currentPlayer?.id ?? null);

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
    if (!window.confirm('Reset everything? Scores, history and player names are all cleared.'))
      return;
    dispatch({ type: 'resetAll' });
    setDraft(emptyDraft());
  }

  function newGame() {
    if (!window.confirm('Start a new game? Scores and history will be cleared. Players are kept.'))
      return;
    dispatch({ type: 'newGame' });
    setDraft(emptyDraft());
  }

  return (
    <>
      <TopBar title="Scrabble">
        {!room && <HostRoomButton game="scrabble" existing={describeGame(state)} />}
        {isHost && (
          <>
            <button
              type="button"
              className="ghost"
              onClick={newGame}
              title="Clear the scores and keep the players"
            >
              <RotateCcw size={15} aria-hidden="true" /> <span className="btn-label">New game</span>
            </button>
            <button
              type="button"
              className="ghost danger"
              onClick={resetAll}
              title="Clear the scores and the players"
            >
              <Trash2 size={15} aria-hidden="true" /> <span className="btn-label">Reset all</span>
            </button>
          </>
        )}
      </TopBar>

      <main>
        <RoomStrip room={room} players={state.players} dispatch={dispatch} gone={gone} />

        <PlayersCard
          players={state.players}
          turns={state.turns}
          currentPlayerId={currentPlayer?.id ?? null}
          editable={isHost}
          selectable={isHost}
          youId={room?.seatId ?? null}
          onAdd={(names) => dispatch({ type: 'addPlayers', names })}
          onRemove={(id) => dispatch({ type: 'removePlayer', id })}
          onMove={(id, to) => dispatch({ type: 'movePlayer', id, to })}
          onSelect={(id) => dispatch({ type: 'setCurrent', id })}
        />

        <TurnEntry
          draft={draft}
          setDraft={setDraft}
          currentPlayer={currentPlayer}
          turnNumber={turnNumber}
          onScore={scoreTurn}
          onPass={pass}
          disabled={blocked(room, 'recordPlay')}
          yourTurn={yourTurn}
          onOpenDictionary={() => setDictOpen(true)}
        />

        <HistoryCard
          players={state.players}
          turns={state.turns}
          canUndo={allowed(room, 'undo')}
          canAdjust={isHost}
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
