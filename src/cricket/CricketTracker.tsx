import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Trash2, Trophy } from 'lucide-react';
import { PlayersCard } from '../shared/PlayersCard';
import { CricketBoard } from './components/CricketBoard';
import { DartEntry } from './components/DartEntry';
import { TARGETS, computeBoard, dartShorthand, previewTurn, standings } from '@shared/games/cricket/rules';
import { useCricket } from './lib/useCricket';
import type { Dart, Variant } from '@shared/games/cricket/types';

const VARIANTS: { value: Variant; label: string; blurb: string }[] = [
  { value: 'standard', label: 'Standard', blurb: 'Points are yours. Highest score wins.' },
  { value: 'cutthroat', label: 'Cut-throat', blurb: 'Points go to opponents. Lowest score wins.' },
  { value: 'nopoints', label: 'No points', blurb: 'Marks only. First to close all seven wins.' },
];

const WIN_REASON: Record<Variant, string> = {
  standard: 'Closed every target and ahead on points.',
  cutthroat: 'Closed every target with the lowest score.',
  nopoints: 'First to close every target.',
};

export function CricketTracker() {
  const { state, dispatch } = useCricket();
  const [darts, setDarts] = useState<Dart[]>([]);

  const currentPlayer = state.players[state.currentIndex] ?? null;

  /**
   * The board includes the throw in progress, so marks appear as each dart is
   * entered rather than only when the turn ends.
   */
  const board = useMemo(() => {
    const pending = darts.length && currentPlayer
      ? [...state.turns, { id: 'in-progress', playerId: currentPlayer.id, darts }]
      : state.turns;
    return computeBoard(state.players, pending, state.variant);
  }, [state.players, state.turns, state.variant, currentPlayer, darts]);

  const winner = state.players.find((p) => p.id === board.winnerId) ?? null;

  // A game can be won on the first or second dart of a turn. Bank the throw so
  // the win survives a reload instead of living only in the draft.
  useEffect(() => {
    if (winner && darts.length) {
      dispatch({ type: 'recordTurn', darts });
      setDarts([]);
    }
  }, [winner, darts, dispatch]);

  const preview = useMemo(
    () => (currentPlayer
      ? previewTurn(state.players, state.turns, state.variant, currentPlayer.id, darts)
      : { marks: 0, points: 0 }),
    [state.players, state.turns, state.variant, currentPlayer, darts],
  );

  // Non-destructive: every dart is kept and simply rescored under the new mode,
  // so this needs no confirmation and can be switched back at any point.
  const changeVariant = (variant: Variant) => dispatch({ type: 'setVariant', variant });

  /**
   * Dropping a player deletes their turns, which rescores the whole game - a
   * target they had closed may come back to life for everyone else. Confirm
   * first if they have anything to lose.
   */
  function removePlayer(id: string) {
    const player = state.players.find((p) => p.id === id);
    if (!player) return;

    const marks = TARGETS.reduce((sum, t) => sum + (board.marks[id]?.[t] ?? 0), 0);
    const points = board.points[id] ?? 0;

    if (marks > 0 || points > 0) {
      const held = [
        marks > 0 ? `${marks} mark${marks === 1 ? '' : 's'}` : '',
        points > 0 ? `${points} point${points === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ');

      const ok = window.confirm(
        `Remove ${player.name}? They have ${held}. Their throws are deleted and the game is rescored, which can change other players' totals.`,
      );
      if (!ok) return;
    }

    dispatch({ type: 'removePlayer', id });
    setDarts([]);
  }

  function resetAll() {
    if (!window.confirm('Reset everything? The board, history and player names are all cleared.')) return;
    dispatch({ type: 'resetAll' });
    setDarts([]);
  }

  function newGame() {
    if (!window.confirm('Start a new game? The board is cleared and players are kept.')) return;
    dispatch({ type: 'newGame' });
    setDarts([]);
  }

  /**
   * Darts already entered belong to the player who was up when they landed, so
   * bank them before handing over rather than letting them follow the seat.
   */
  function selectPlayer(id: string) {
    if (id === currentPlayer?.id) return;
    if (darts.length) {
      dispatch({ type: 'recordTurn', darts });
      setDarts([]);
    }
    dispatch({ type: 'setCurrent', id });
  }

  function undo() {
    if (darts.length) {
      setDarts([]); // clear the throw in progress before touching history
      return;
    }
    dispatch({ type: 'undo' });
  }

  return (
    <>
      <header className="topbar">
        <Link className="back" to="/" aria-label="All games">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <h1>Cricket</h1>
        <div className="topbar-actions">
          <button
            type="button"
            className="ghost"
            onClick={newGame}
            title="Clear the board and keep the players"
          >
            <RotateCcw size={15} aria-hidden="true" /> New game
          </button>
          <button
            type="button"
            className="ghost danger"
            onClick={resetAll}
            title="Clear the board and the players"
          >
            <Trash2 size={15} aria-hidden="true" /> Reset all
          </button>
        </div>
      </header>

      <main>
        {winner && (
          <div className="banner win" role="status">
            <Trophy size={18} aria-hidden="true" className="mark" />
            <span><b>{winner.name} wins.</b> {WIN_REASON[state.variant]}</span>
          </div>
        )}

        <PlayersCard
          players={state.players}
          onAdd={(names) => dispatch({ type: 'addPlayers', names })}
          onRemove={removePlayer}
          headerExtra={
            <div className="seg" role="group" aria-label="Game mode">
              {VARIANTS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  className={state.variant === v.value ? 'on' : undefined}
                  aria-pressed={state.variant === v.value}
                  title={v.blurb}
                  onClick={() => changeVariant(v.value)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          }
        >
          <CricketBoard
            players={state.players}
            board={board}
            variant={state.variant}
            currentPlayerId={currentPlayer?.id ?? null}
            onSelect={selectPlayer}
          />
        </PlayersCard>

        <DartEntry
          currentPlayer={currentPlayer}
          board={board}
          preview={preview}
          darts={darts}
          onChangeDarts={setDarts}
          onRecord={(thrown) => dispatch({ type: 'recordTurn', darts: thrown })}
          onUndo={undo}
          canUndo={darts.length > 0 || state.turns.length > 0}
          disabled={Boolean(winner)}
        />

        <section className="card">
          <div className="card-head"><h2>History</h2></div>
          <ol className="history">
            {state.turns.length === 0 && <li className="muted">No darts thrown yet.</li>}
            {[...state.turns].reverse().map((turn) => (
              <li key={turn.id}>
                <span className="who">
                  {state.players.find((p) => p.id === turn.playerId)?.name ?? '-'}
                </span>
                <span className="what">
                  {turn.darts.map((d) => dartShorthand(d)).join('  ')}
                </span>
              </li>
            ))}
          </ol>

          {state.players.length > 1 && (
            <p className="hint">
              {standings(state.players, board, state.variant)
                .map((s) => `${s.player.name} ${s.points}`)
                .join(' · ')}
            </p>
          )}
        </section>
      </main>
    </>
  );
}
