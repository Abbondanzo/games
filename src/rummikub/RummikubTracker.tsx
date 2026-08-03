import { Link } from 'react-router-dom';
import { ArrowLeft, Crown, RotateCcw, Trash2 } from 'lucide-react';
import { PlayersCard } from '../shared/PlayersCard';
import { RoundEntry } from './components/RoundEntry';
import { roundScores, standings } from './lib/rummikub';
import { useRummikub } from './lib/useRummikub';

export function RummikubTracker() {
  const { state, dispatch } = useRummikub();
  const rows = standings(state.players, state.rounds);
  const best = rows.length ? Math.max(...rows.map((r) => r.score)) : 0;
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? '-';

  function removePlayer(id: string) {
    const player = state.players.find((p) => p.id === id);
    if (!player) return;

    const wonRounds = state.rounds.filter((r) => r.winnerId === id).length;
    const playedAny = state.rounds.length > 0;

    if (playedAny) {
      const detail = wonRounds
        ? ` The ${wonRounds} round${wonRounds === 1 ? '' : 's'} they won will be deleted, and`
        : '';
      const ok = window.confirm(
        `Remove ${player.name}?${detail} every round is rescored, which can change other players' totals.`,
      );
      if (!ok) return;
    }
    dispatch({ type: 'removePlayer', id });
  }

  function newGame() {
    if (!window.confirm('Start a new game? All rounds are cleared and players are kept.')) return;
    dispatch({ type: 'newGame' });
  }

  function resetAll() {
    if (!window.confirm('Reset everything? Rounds and player names are all cleared.')) return;
    dispatch({ type: 'resetAll' });
  }

  return (
    <>
      <header className="topbar">
        <Link className="back" to="/" aria-label="All games">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <h1>Rummikub</h1>
        <div className="topbar-actions">
          <button
            type="button"
            className="ghost"
            onClick={newGame}
            title="Clear the rounds and keep the players"
          >
            <RotateCcw size={15} aria-hidden="true" /> New game
          </button>
          <button
            type="button"
            className="ghost danger"
            onClick={resetAll}
            title="Clear the rounds and the players"
          >
            <Trash2 size={15} aria-hidden="true" /> Reset all
          </button>
        </div>
      </header>

      <main>
        <PlayersCard
          players={state.players}
          onAdd={(names) => dispatch({ type: 'addPlayers', names })}
          onRemove={removePlayer}
        >
          <ol className="scoreboard">
            {rows.map((row, i) => (
              <li key={row.player.id}>
                <div className="scoreboard-row static">
                  <span className="rank">{i + 1}.</span>
                  <span className="name">{row.player.name}</span>
                  {state.rounds.length > 0 && row.score === best && (
                    <span className="leader">
                      <Crown size={13} aria-hidden="true" /> leading
                    </span>
                  )}
                  {row.wins > 0 && (
                    <span className="avg">
                      {row.wins} round{row.wins === 1 ? '' : 's'} won
                    </span>
                  )}
                  <span className={`pts${row.score < 0 ? ' neg' : ''}`}>{row.score}</span>
                </div>
              </li>
            ))}
          </ol>
        </PlayersCard>

        <RoundEntry
          players={state.players}
          roundNumber={state.rounds.length + 1}
          onScore={(winnerId, penalties) => dispatch({ type: 'recordRound', winnerId, penalties })}
        />

        <section className="card">
          <div className="card-head">
            <h2>History</h2>
            {state.rounds.length > 0 && (
              <button type="button" className="link" onClick={() => dispatch({ type: 'undo' })}>
                Undo last
              </button>
            )}
          </div>

          <ol className="history">
            {state.rounds.length === 0 && <li className="muted">No rounds played yet.</li>}
            {[...state.rounds].reverse().map((round, i) => {
              const scores = roundScores(state.players, round);
              return (
                <li key={round.id}>
                  <span className="who">Round {state.rounds.length - i}</span>
                  <span className="what">
                    <span className="plain">{name(round.winnerId)} out</span>
                  </span>
                  <span className="got">
                    {state.players
                      .map((p) => `${p.name} ${scores[p.id]! > 0 ? '+' : ''}${scores[p.id] ?? 0}`)
                      .join('  ')}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      </main>
    </>
  );
}
