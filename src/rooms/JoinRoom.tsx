import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DoorOpen } from 'lucide-react';
import { CODE_LENGTH, normaliseCode } from '@shared/rooms/codes';
import { TopBar } from '../shared/TopBar';
import { ROOM_ERRORS, joinRoom, peekRoom, type Peek, type RoomError } from './api';
import { deviceFor, readName, writeName, writeSession } from './storage';

/**
 * Joining, whether the code was typed on the home page or arrived as a link.
 *
 * The code is looked up before joining, because until it resolves there is no
 * way to know which game it belongs to - and, if the host laid the table out
 * before anyone arrived, no way to know that "Grace" is sitting there waiting
 * to be claimed. Looking it up as soon as the code is complete is what lets
 * that be offered before a name is typed rather than after.
 */
export function JoinRoom() {
  const { code: linkCode } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [code, setCode] = useState(linkCode?.toUpperCase() ?? '');
  const [name, setName] = useState(readName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RoomError | 'bad-code' | 'no-name' | null>(null);
  const [room, setRoom] = useState<Peek | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /**
   * Look the code up as soon as it is a code. Quietly: a wrong one is the
   * ordinary state of a half-typed field, and saying so is the submit's job.
   */
  useEffect(() => {
    const clean = normaliseCode(code);
    if (!clean) {
      setRoom(null);
      return undefined;
    }

    let current = true;
    void peekRoom(clean).then((found) => {
      if (current) setRoom(found.ok ? found.value : null);
    });
    return () => {
      current = false;
    };
  }, [code]);

  /** Everything that happens once the room has said yes. */
  function entered(game: Peek['game'], session: Parameters<typeof writeSession>[0]) {
    writeSession(session);
    // Replace, so Back does not try to join a second time.
    navigate(`/${game}`, { replace: true });
    // The session is read once on mount, so the tracker needs a fresh start.
    window.location.reload();
  }

  async function go(wanted: string, claim: string | null) {
    const clean = normaliseCode(code);
    if (!clean) {
      setError('bad-code');
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

    // The secret this device keeps for this room, which is how the room tells
    // somebody coming back from somebody new. Minted here the first time.
    const joined = await joinRoom(clean, wanted, deviceFor(found.value.game, clean), claim);
    setBusy(false);
    if (!joined.ok) {
      setError(joined.error);
      return;
    }

    if (wanted) writeName(wanted);
    entered(found.value.game, joined.value);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError('no-name');
      return;
    }
    void go(name.trim(), null);
  }

  const waiting = room?.claimable ?? [];

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

          {waiting.length > 0 && (
            <fieldset className="claim">
              <legend>Has the host already added you?</legend>
              <div className="seg wrap">
                {waiting.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    disabled={busy}
                    aria-label={`Join as ${player.name}`}
                    onClick={() => void go(player.name, player.id)}
                  >
                    {player.name}
                  </button>
                ))}
              </div>
              <p className="hint">Or add yourself below.</p>
            </fieldset>
          )}

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
