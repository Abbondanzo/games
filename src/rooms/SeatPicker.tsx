import type { RoomHandle } from './session';

interface Props {
  room: RoomHandle;
  players: { id: string; name: string }[];
}

/**
 * Which player you are. Shown until you pick, because until then the room has
 * no way to know whose scores you are allowed to enter.
 */
export function SeatPicker({ room, players }: Props) {
  if (room.role === 'host' || room.seatId) return null;

  const taken = new Set(room.members.map((m) => m.seatId).filter(Boolean));
  const free = players.filter((p) => !taken.has(p.id));

  if (!players.length) {
    return (
      <section className="card">
        <p className="muted">Waiting for the host to add the players.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head"><h2>Which one are you?</h2></div>
      <div className="seg wrap">
        {free.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-label={`Play as ${p.name}`}
            onClick={() => room.claimSeat(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      {!free.length && <p className="muted">Everyone is taken. Ask the host to add you.</p>}
      <p className="hint">Pick your name to enter your own scores, or just watch.</p>
    </section>
  );
}
