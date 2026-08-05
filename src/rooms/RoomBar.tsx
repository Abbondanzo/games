import {
  Copy,
  Crown,
  DoorOpen,
  Lock,
  LockOpen,
  Pencil,
  PowerOff,
  UserX,
  Users,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { VERSION_MESSAGES } from '@shared/rooms/protocol';
import type { RoomHandle } from './session';
import { writeName } from './storage';
import { isHost as amHost } from './whoAmI';

/**
 * The room, as a strip under the top bar: who is here, what your part is, and
 * the host's controls. Deliberately one row until you open it.
 */
interface Props {
  room: RoomHandle;
  onLeave: () => void;
  /** Your player's current name, so the field starts from it. */
  myName: string | null;
  onRename: (name: string) => void;
}

export function RoomBar({ room, onLeave, myName, onRename }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  function submitName(event: FormEvent) {
    event.preventDefault();
    const wanted = draftName.trim();
    if (wanted && wanted !== myName) {
      onRename(wanted);
      // Correcting your name here is the last word on what to call yourself, so
      // it becomes the default for the next room rather than the name you
      // arrived under.
      writeName(wanted);
    }
    setRenaming(false);
  }

  const online = room.members.filter((m) => m.online).length;
  const isHost = amHost(room);

  /** One host at a time, so this gives it up as well as handing it over. */
  function handOver(memberId: string, name: string) {
    const warning = `Put ${name} in charge of the room? They will be able to change the game and remove people, and you will not.`;
    if (window.confirm(warning)) room.makeHost(memberId);
  }

  function endRoom() {
    const others = room.members.length - 1;
    const warning =
      others > 0
        ? `Close the room? The ${others} other ${others === 1 ? 'person' : 'people'} here will stop seeing the score. The game stays on this device.`
        : 'Close the room? The game stays on this device.';
    if (window.confirm(warning)) room.close();
  }

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
            : room.status === 'connecting'
              ? 'Getting back to the room'
              : 'Not connected'}
        </span>
        {room.locked && (
          <span className="muted locked-tag">
            <Lock size={12} aria-hidden="true" /> locked
          </span>
        )}
        <button type="button" className="link" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Who is here'}
        </button>
        {/* Getting out should not be hidden behind a disclosure. */}
        {!isHost && (
          <button type="button" className="link leave-link" onClick={onLeave}>
            Leave
          </button>
        )}
      </div>

      {room.outdated && (
        <p className="room-error" role="status">
          {VERSION_MESSAGES[room.outdated]}
        </p>
      )}

      {open && (
        <div className="room-detail">
          {myName !== null &&
            (renaming ? (
              <form className="row rename-row" onSubmit={submitName}>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  maxLength={24}
                  aria-label="Your name"
                  autoComplete="off"
                />
                <button type="submit" className="primary">
                  Save
                </button>
                <button type="button" className="ghost" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <p className="you-are">
                You are <b>{myName}</b>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setDraftName(myName);
                    setRenaming(true);
                  }}
                >
                  <Pencil size={13} aria-hidden="true" /> Change name
                </button>
              </p>
            ))}

          <ul className="chips">
            {room.members.map((m) => (
              <li key={m.memberId} className={m.online ? undefined : 'away'}>
                {m.name}
                {m.role === 'host' && <span className="muted"> host</span>}
                {isHost && m.memberId !== room.memberId && (
                  <>
                    <button
                      type="button"
                      aria-label={`Put ${m.name} in charge of the room`}
                      title={`Put ${m.name} in charge`}
                      onClick={() => handOver(m.memberId, m.name)}
                    >
                      <Crown size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${m.name} from the room`}
                      onClick={() => room.kick(m.memberId)}
                    >
                      <UserX size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {isHost && room.removed.length > 0 && (
            <div className="removed-list">
              <p className="muted">Removed from this game</p>
              <ul className="chips">
                {room.removed.map((person) => (
                  <li key={person.ref}>
                    {person.name}
                    <button
                      type="button"
                      className="link"
                      aria-label={`Let ${person.name} back into the game`}
                      onClick={() => room.allowBack(person.ref)}
                    >
                      Let back in
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="room-actions">
            <button type="button" className="ghost" onClick={() => void copyLink()}>
              <Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy invite'}
            </button>
            {isHost && (
              <button type="button" className="ghost" onClick={() => room.setLocked(!room.locked)}>
                {room.locked ? (
                  <>
                    <LockOpen size={15} aria-hidden="true" /> Allow new players
                  </>
                ) : (
                  <>
                    <Lock size={15} aria-hidden="true" /> Stop new players
                  </>
                )}
              </button>
            )}
            {isHost ? (
              <button type="button" className="ghost danger" onClick={endRoom}>
                <PowerOff size={15} aria-hidden="true" /> Close room
              </button>
            ) : (
              <button type="button" className="ghost danger" onClick={onLeave}>
                <DoorOpen size={15} aria-hidden="true" /> Leave the room
              </button>
            )}
          </div>

          {!isHost && (
            <p className="hint">
              Leaving stops you following the score. Your own games on this device are untouched,
              and the players here keep theirs.
            </p>
          )}

          {isHost && (
            <p className="hint">
              Share the code or the link. Anyone who joins can pick their name and enter their own
              scores; only you can change the rules. Stopping new players closes the door without
              ending anything. Removing somebody keeps them out for the rest of the game, whether
              the room is open or not, until you let them back. You can put someone else in charge,
              which is how to leave without ending the game. Closing the room ends it for everyone
              and keeps the game on this device.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
