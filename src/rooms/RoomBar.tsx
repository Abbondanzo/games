import { Copy, DoorOpen, Lock, LockOpen, UserX, Users } from 'lucide-react';
import { useState } from 'react';
import type { RoomHandle } from './session';

/**
 * The room, as a strip under the top bar: who is here, what your part is, and
 * the host's controls. Deliberately one row until you open it.
 */
export function RoomBar({ room, onLeave }: { room: RoomHandle; onLeave: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const online = room.members.filter((m) => m.online).length;
  const isHost = room.role === 'host';

  async function copyLink() {
    const link = `${window.location.origin}/#/join/${room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be refused; the code is on screen to read out anyway.
    }
  }

  return (
    <section className={`room-bar${room.status !== 'open' ? ' waiting' : ''}`}>
      <div className="room-summary">
        <button type="button" className="room-code" onClick={() => setOpen((v) => !v)}>
          <Users size={15} aria-hidden="true" />
          <span className="code">{room.code}</span>
        </button>
        <span className="muted">
          {room.status === 'open'
            ? `${online} here`
            : room.status === 'connecting' ? 'Getting back to the room' : 'Not connected'}
        </span>
        {room.locked && <span className="muted locked-tag"><Lock size={12} aria-hidden="true" /> locked</span>}
        <button type="button" className="link" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Who is here'}
        </button>
      </div>

      {open && (
        <div className="room-detail">
          <ul className="chips">
            {room.members.map((m) => (
              <li key={m.memberId} className={m.online ? undefined : 'away'}>
                {m.name}
                {m.role === 'host' && <span className="muted"> host</span>}
                {isHost && m.memberId !== room.memberId && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name} from the room`}
                    onClick={() => room.kick(m.memberId)}
                  >
                    <UserX size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="room-actions">
            <button type="button" className="ghost" onClick={() => void copyLink()}>
              <Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy invite'}
            </button>
            {isHost && (
              <button type="button" className="ghost" onClick={() => room.setLocked(!room.locked)}>
                {room.locked
                  ? <><LockOpen size={15} aria-hidden="true" /> Let people in</>
                  : <><Lock size={15} aria-hidden="true" /> Close the room</>}
              </button>
            )}
            <button type="button" className="ghost danger" onClick={onLeave}>
              <DoorOpen size={15} aria-hidden="true" /> Leave
            </button>
          </div>

          {isHost && (
            <p className="hint">
              Share the code or the link. Anyone who joins can pick their name and enter their
              own scores; only you can change the players or the rules.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
