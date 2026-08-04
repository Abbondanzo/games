import { useState } from 'react';
import { Users } from 'lucide-react';
import type { RoomHandle } from '../../rooms/session';
import type { Player } from '@shared/games/rummikub/types';
import { WinnerPick } from './WinnerPick';

interface Props {
  players: Player[];
  roundNumber: number;
  room: RoomHandle;
}

/**
 * Between rounds, in a room.
 *
 * The host says who went out, which opens the round; everyone then fills in
 * their own rack. Guests have nothing to do until that happens, and are told so
 * rather than being shown controls that would be refused.
 */
export function OpenRound({ players, roundNumber, room }: Props) {
  const [winnerId, setWinnerId] = useState<string | null>(null);

  if (room.role !== 'host') {
    return (
      <section className="card">
        <div className="card-head"><h2>Round <span className="muted">#{roundNumber}</span></h2></div>
        <p className="muted">Waiting for the host to say who went out.</p>
      </section>
    );
  }

  if (players.length < 2) {
    return (
      <section className="card">
        <p className="muted">Add at least two players to score a round.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head"><h2>Round <span className="muted">#{roundNumber}</span></h2></div>

      <WinnerPick players={players} value={winnerId} onPick={setWinnerId} />

      <div className="total-row">
        <div className="total-actions">
          <button
            type="button"
            className="primary"
            disabled={!winnerId}
            onClick={() => winnerId && room.openRound(winnerId)}
          >
            <Users size={15} aria-hidden="true" /> Collect tiles
          </button>
        </div>
      </div>

      <p className="hint">
        Everyone enters their own tiles, and you score the round once they are in.
      </p>
    </section>
  );
}
