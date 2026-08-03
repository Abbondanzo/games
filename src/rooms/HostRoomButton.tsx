import { useState, type FormEvent } from 'react';
import { Users } from 'lucide-react';
import type { Game } from '@shared/rooms/protocol';
import { ROOM_ERRORS, createRoom, type RoomError } from './api';
import { readName, writeName, writeSession } from './storage';

/**
 * Starts sharing the game on screen.
 *
 * The host names themselves first, because that name goes on the scoreboard
 * exactly as a joiner's does. From the moment the room exists it is the source
 * of truth, so this is a one-way door until the room is closed.
 */
export function HostRoomButton({ game }: { game: Game }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RoomError | null>(null);

  async function start(event: FormEvent) {
    event.preventDefault();
    const chosen = name.trim();
    if (!chosen) return;

    setBusy(true);
    setError(null);
    const result = await createRoom(game, chosen);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    writeName(chosen);
    writeSession(result.value);
    // The session is read once on mount, so a reload is the simplest way in.
    window.location.reload();
  }

  return (
    <>
      <button type="button" className="ghost" onClick={() => setOpen(true)}>
        <Users size={15} aria-hidden="true" />{' '}
        <span className="btn-label">Share</span>
      </button>

      {open && (
        <div className="drawer" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="drawer-panel" role="dialog" aria-modal="true" aria-label="Share this game">
            <div className="card-head">
              <h2>Share this game</h2>
              <button type="button" className="link" onClick={() => setOpen(false)}>Close</button>
            </div>

            <form className="join-form" onSubmit={start}>
              <label className="field">
                <span>Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  autoComplete="off"
                  aria-label="Your name"
                  autoFocus
                />
              </label>

              <button type="submit" className="primary" disabled={busy || !name.trim()}>
                <Users size={15} aria-hidden="true" /> {busy ? 'Starting' : 'Start sharing'}
              </button>

              {error && <p className="room-error" role="status">{ROOM_ERRORS[error]}</p>}

              <p className="hint">
                You get a code to share. Everyone who joins is added to the game and enters their
                own scores. This starts a fresh game.
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
