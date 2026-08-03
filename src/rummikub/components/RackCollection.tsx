import { useState } from 'react';
import { Check, Trophy, X } from 'lucide-react';
import type { RoomHandle } from '../../rooms/session';
import type { Player } from '@shared/games/rummikub/types';
import { JOKER_PENALTY } from '@shared/games/rummikub/rules';
import { TileButtons } from './TileButtons';

interface Props {
  players: Player[];
  roundNumber: number;
  room: RoomHandle;
  onScore: (winnerId: string, penalties: Record<string, number>) => void;
}

/**
 * A round being collected.
 *
 * Rummikub records every rack at once, so unlike a dart or a word it cannot be
 * scoped to one seat. Instead the host opens a round, everyone enters their own
 * rack, and the host commits when they are in. What is collected lives in room
 * state, so the game itself never learns about half-finished rounds.
 */
export function RackCollection({ players, roundNumber, room, onScore }: Props) {
  const pending = room.pending!;
  const winner = players.find((p) => p.id === pending.winnerId);
  const losers = players.filter((p) => p.id !== pending.winnerId);

  const missing = losers.filter((p) => pending.racks[p.id] === undefined);
  const pot = Object.values(pending.racks).reduce((a, b) => a + b, 0);
  const isHost = room.role === 'host';

  return (
    <section className="card">
      <div className="card-head">
        <h2>Round <span className="muted">#{roundNumber}</span></h2>
        <div className="whose-turn">
          <Trophy size={14} aria-hidden="true" /> {winner?.name ?? 'Someone'} went out
        </div>
      </div>

      {room.seatId && room.seatId !== pending.winnerId && (
        <MyRack
          key={room.seatId}
          submitted={pending.racks[room.seatId]}
          onSubmit={(total) => room.submitRack(room.seatId!, total)}
        />
      )}

      {room.seatId === pending.winnerId && (
        <p className="muted">You went out, so you have nothing left to count.</p>
      )}

      <ul className="rack-progress">
        {losers.map((p) => {
          const total = pending.racks[p.id];
          return (
            <li key={p.id} className={total === undefined ? undefined : 'in'}>
              {total === undefined ? `waiting for ${p.name}` : `${p.name} ${total}`}
            </li>
          );
        })}
      </ul>

      {isHost && (
        <>
          {missing.length > 0 && (
            <>
              <p className="hint">
                Anyone without a phone can be entered here.
              </p>
              {missing.map((p) => (
                <MyRack
                  key={p.id}
                  label={p.name}
                  onSubmit={(total) => room.submitRack(p.id, total)}
                />
              ))}
            </>
          )}

          <div className="total-row">
            <div className="total">
              <span className="muted">{winner?.name ?? 'The winner'} scores</span>
              <strong data-testid="round-pot">+{pot}</strong>
            </div>
            <div className="total-actions">
              <button type="button" className="ghost" onClick={room.cancelRound}>
                <X size={15} aria-hidden="true" /> Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => onScore(pending.winnerId, pending.racks)}
              >
                <Check size={15} aria-hidden="true" /> Score round
              </button>
            </div>
          </div>
          {missing.length > 0 && (
            <p className="hint">
              Anyone still missing counts as nothing if you score it now.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** One person's own rack, submittable and correctable until the round is scored. */
function MyRack({
  submitted, label, onSubmit,
}: {
  submitted?: number;
  label?: string;
  onSubmit: (total: number) => void;
}) {
  const [taps, setTaps] = useState<number[]>([]);
  const total = taps.reduce((a, b) => a + b, 0);

  return (
    <div className="my-rack">
      <div className="my-rack-head">
        <span className="rack-title">{label ? `${label}'s tiles` : 'Your tiles'}</span>
        {submitted !== undefined && <span className="muted">sent: {submitted}</span>}
      </div>

      <div className="rack-tiles">
        {taps.map((v, i) => (
          <span key={i} className={`rack-tile${v === JOKER_PENALTY ? ' joker' : ''}`}>
            {v === JOKER_PENALTY ? 'J' : v}
          </span>
        ))}
      </div>

      <input
        type="number"
        min="0"
        inputMode="numeric"
        className="rack-total"
        aria-label={label ? `Tiles left for ${label}` : 'Your tiles left'}
        value={total || ''}
        placeholder="0"
        onChange={(e) => {
          const value = Number.parseInt(e.target.value, 10);
          setTaps(Number.isFinite(value) && value > 0 ? [value] : []);
        }}
      />

      <TileButtons
        onAdd={(v) => setTaps((t) => [...t, v])}
        onUndo={() => setTaps((t) => t.slice(0, -1))}
        canUndo={taps.length > 0}
      />

      <button
        type="button"
        className="primary"
        onClick={() => onSubmit(total)}
        aria-label={
          submitted === undefined
            ? (label ? `Send ${label}'s tiles` : 'Send your tiles')
            : (label ? `Update ${label}'s tiles` : 'Update your tiles')
        }
      >
        {submitted === undefined ? 'Send' : 'Update'}
      </button>
    </div>
  );
}
