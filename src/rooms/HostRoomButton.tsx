import { useState } from 'react';
import { Users } from 'lucide-react';
import type { Game } from '@shared/rooms/protocol';
import { ROOM_ERRORS, createRoom, type RoomError } from './api';
import { writeSession } from './storage';

/**
 * Starts sharing the game you are already looking at. The room takes over as
 * the source of truth from the moment it is created, so this is a one-way door
 * until you leave.
 */
export function HostRoomButton({ game }: { game: Game }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RoomError | null>(null);

  async function host() {
    setBusy(true);
    setError(null);
    const result = await createRoom(game, 'Host');
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    writeSession(result.value);
    // The session is read once on mount, so a reload is the simplest way in.
    window.location.reload();
  }

  return (
    <>
      <button type="button" className="ghost" onClick={() => void host()} disabled={busy}>
        <Users size={15} aria-hidden="true" />{' '}
        <span className="btn-label">{busy ? 'Starting' : 'Share'}</span>
      </button>
      {error && <span className="room-error">{ROOM_ERRORS[error]}</span>}
    </>
  );
}
