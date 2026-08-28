import { useMemo, useState } from 'react';
import { RotateCcw, Trash2, Trophy } from 'lucide-react';
import { PlayersCard } from '../shared/PlayersCard';
import { ScoreSheet, type Selection } from './components/ScoreSheet';
import { ScorePad } from './components/ScorePad';
import { BOXES, LABELS, roundNumber, sheets, winners } from '@shared/games/yahtzee/rules';
import { useYahtzee } from './lib/useYahtzee';
import { RoomStrip } from '../rooms/RoomStrip';
import { WhoseTurn } from '../rooms/WhoseTurn';
import { TopBar } from '../shared/TopBar';
import { allowed, blocked, isHost as amHost, isMyTurn } from '../rooms/whoAmI';
import { summarise } from '../rooms/describeGame';
import { HostRoomButton } from '../rooms/HostRoomButton';

const describeGame = (s: { players: unknown[]; turns: unknown[] }) =>
  summarise([
    [s.players.length, 'player'],
    [s.turns.length, 'box'],
  ]);

export function YahtzeeTracker() {
  const { state, dispatch, room, gone } = useYahtzee();
  const [selected, setSelected] = useState<Selection | null>(null);

  const isHost = amHost(room);
  const currentPlayer = state.players[state.currentIndex] ?? null;
  const yourTurn = isMyTurn(room, currentPlayer?.id ?? null);

  const board = useMemo(
    () => sheets(state.players, state.turns, state.bonuses),
    [state.players, state.turns, state.bonuses],
  );

  const won = useMemo(
    () => winners(state.players, state.turns, state.bonuses),
    [state.players, state.turns, state.bonuses],
  );

  /**
   * The host fills in for whoever calls out a score, so every column is theirs
   * to tap. A player has one column, and a watcher has none: their sheet is
   * plain numbers rather than buttons that would only refuse.
   */
  const canFill = (playerId: string) => (room ? isHost || playerId === room.seatId : true);

  const selectedPlayer = selected
    ? (state.players.find((p) => p.id === selected.playerId) ?? null)
    : null;

  // A box the host tapped can vanish under them: the player might be removed,
  // or the game started again. Dropping the pad is better than pointing it at
  // a sheet that is no longer there.
  const open = selectedPlayer && selected ? selected : null;

  function score(value: number) {
    if (!open || open.category === 'yahtzeeBonus') return;
    dispatch({ type: 'score', playerId: open.playerId, category: open.category, value });
    setSelected(null);
  }

  function clearBox() {
    if (!open || open.category === 'yahtzeeBonus') return;
    dispatch({ type: 'clearBox', playerId: open.playerId, category: open.category });
    setSelected(null);
  }

  function removePlayer(id: string) {
    const player = state.players.find((p) => p.id === id);
    if (!player) return;

    const filled = board[id]?.filled ?? 0;
    if (filled > 0) {
      const ok = window.confirm(
        `Remove ${player.name}? Their sheet is deleted, including the ${filled} box${filled === 1 ? '' : 'es'} already filled in.`,
      );
      if (!ok) return;
    }
    if (selected?.playerId === id) setSelected(null);
    dispatch({ type: 'removePlayer', id });
  }

  function newGame() {
    if (!window.confirm('Start a new game? Every sheet is cleared and players are kept.')) return;
    setSelected(null);
    dispatch({ type: 'newGame' });
  }

  function resetAll() {
    if (!window.confirm('Reset everything? The sheets and player names are all cleared.')) return;
    setSelected(null);
    dispatch({ type: 'resetAll' });
  }

  function undo() {
    setSelected(null);
    dispatch({ type: 'undo' });
  }

  return (
    <>
      <TopBar title="Yahtzee">
        {!room && <HostRoomButton game="yahtzee" existing={describeGame(state)} />}
        {isHost && (
          <>
            <button
              type="button"
              className="ghost"
              onClick={newGame}
              title="Clear the sheets and keep the players"
            >
              <RotateCcw size={15} aria-hidden="true" /> <span className="btn-label">New game</span>
            </button>
            <button
              type="button"
              className="ghost danger"
              onClick={resetAll}
              title="Clear the sheets and the players"
            >
              <Trash2 size={15} aria-hidden="true" /> <span className="btn-label">Reset all</span>
            </button>
          </>
        )}
      </TopBar>

      <main>
        <RoomStrip room={room} players={state.players} dispatch={dispatch} gone={gone} />

        {won.length > 0 && (
          <div className="banner win" role="status">
            <Trophy size={18} aria-hidden="true" className="mark" />
            <span>
              {won.length === 1 ? (
                <>
                  <b>{won[0]!.name} wins.</b> {board[won[0]!.id]?.total ?? 0} points, every box
                  filled.
                </>
              ) : (
                <>
                  <b>{won.map((p) => p.name).join(' and ')} tie.</b> {board[won[0]!.id]?.total ?? 0}{' '}
                  points each.
                </>
              )}
            </span>
          </div>
        )}

        <PlayersCard
          players={state.players}
          editable={isHost}
          onAdd={(names) => dispatch({ type: 'addPlayers', names })}
          onRemove={removePlayer}
          onMove={(id, to) => dispatch({ type: 'movePlayer', id, to })}
          reorderable={state.turns.length === 0}
        >
          <ScoreSheet
            players={state.players}
            sheets={board}
            currentPlayerId={currentPlayer?.id ?? null}
            selected={open}
            onPick={setSelected}
            onSelectPlayer={(id) => dispatch({ type: 'setCurrent', id })}
            selectable={isHost}
            canFill={canFill}
            waiting={blocked(room, 'score')}
            youId={room?.seatId ?? null}
          />
        </PlayersCard>

        {open && selectedPlayer ? (
          <ScorePad
            selection={open}
            player={selectedPlayer}
            sheet={board[selectedPlayer.id]!}
            onScore={score}
            onClear={clearBox}
            onAddBonus={() => {
              dispatch({ type: 'addBonus', playerId: open.playerId });
              setSelected(null);
            }}
            onRemoveBonus={() => {
              dispatch({ type: 'removeBonus', playerId: open.playerId });
              setSelected(null);
            }}
            onCancel={() => setSelected(null)}
            disabled={blocked(room, 'score')}
            yourTurn={yourTurn}
            currentName={currentPlayer?.name ?? null}
          />
        ) : (
          <section className="card entry">
            <div className="card-head">
              <h2>
                {state.players.length
                  ? `Round ${roundNumber(state.players, state.turns, state.bonuses)} of ${BOXES}`
                  : 'Scoring'}
              </h2>
            </div>
            {state.players.length > 0 && (
              <WhoseTurn
                name={currentPlayer?.name ?? null}
                yours={yourTurn}
                nowPlaying="Now playing"
                yoursLabel="Your turn"
                empty="Nobody is up yet."
              />
            )}
            <p className="hint">
              {state.players.length
                ? 'Tap any box on the sheet to fill it in. A turn that scored nothing goes in as a scratch.'
                : 'Add the players to start a sheet for each of them.'}
            </p>
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <h2>History</h2>
            {state.turns.length > 0 && allowed(room, 'undo') && (
              <button type="button" className="link" onClick={undo}>
                Undo last
              </button>
            )}
          </div>
          <ol className="history">
            {state.turns.length === 0 && <li className="muted">No boxes filled in yet.</li>}
            {[...state.turns].reverse().map((turn) => (
              <li key={turn.id}>
                <span className="who">
                  {state.players.find((p) => p.id === turn.playerId)?.name ?? '-'}
                </span>
                <span className="what">
                  <span className="plain">{LABELS[turn.category]}</span>
                </span>
                <span className="got">{turn.value === 0 ? 'scratched' : `+${turn.value}`}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
