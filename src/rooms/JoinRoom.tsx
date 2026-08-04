import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DoorOpen } from 'lucide-react';
import { CODE_LENGTH, normaliseCode } from '@shared/rooms/codes';
import { TopBar } from '../shared/TopBar';
import { ROOM_ERRORS, joinRoom, peekRoom, type RoomError } from './api';
import { readName, recallSeat, writeName, writeSession } from './storage';

/**
 * Joining, whether the code was typed on the home page or arrived as a link.
 *
 * The code is looked up before joining, because until it resolves there is no
 * way to know which game it belongs to.
 */
export function JoinRoom() {
  const { code: linkCode } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [code, setCode] = useState(linkCode?.toUpperCase() ?? '');
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RoomError | 'bad-code' | 'no-name' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = normaliseCode(code);
    if (!clean) {
      setError('bad-code');
      return;
    }

    if (!name.trim()) {
      setError('no-name');
      return;
    }

    setBusy(true);
    setError(null);

    const found = await peekRoom(clean);
    if (!found.ok) {
      setBusy(false);
      setError(found.error);
      return;
    }

    // If this device has been in this room before, ask for the same player
    // back. The room decides; a seat that has gone falls through to the name.
    const joined = await joinRoom(clean, name.trim(), recallSeat(found.value.game, clean));
    setBusy(false);
    if (!joined.ok) {
      setError(joined.error);
      return;
    }

    writeName(name.trim());
    writeSession(joined.value);
    // Replace, so Back does not try to join a second time.
    navigate(`/${found.value.game}`, { replace: true });
    // The session is read once on mount, so the tracker needs a fresh start.
    window.location.reload();
  }

  return (
    <>
      <TopBar title="Join a game" />
      <main className="home">
        <p className="sub">Enter the code the host gave you, and the name you want on the scoreboard.</p>

        <form className="card join-form" onSubmit={submit}>
          <label className="field">
            <span>Room code</span>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={CODE_LENGTH + 2}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-label="Room code"
            />
          </label>

          <label className="field">
            <span>Your name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              autoComplete="off"
              aria-label="Your name"
            />
          </label>

          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            <DoorOpen size={15} aria-hidden="true" /> {busy ? 'Joining' : 'Join'}
          </button>
          <p className="hint">You will be added to the game straight away.</p>

          {error && (
            <p className="room-error" role="status">
              {error === 'bad-code' ? 'That is not a valid code. Check and try again.'
                : error === 'no-name' ? 'Enter the name you want on the scoreboard.'
                : ROOM_ERRORS[error]}
            </p>
          )}
        </form>
      </main>
    </>
  );
}
