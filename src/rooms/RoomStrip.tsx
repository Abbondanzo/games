import { RoomBar } from './RoomBar';
import { RoomNotices } from './RoomNotices';
import { myName, renameSelf } from './whoAmI';
import type { RoomHandle } from './session';
import type { GoneReason } from '@shared/rooms/protocol';

/**
 * Everything the room says for itself, between the top bar and the game.
 *
 * Three trackers had these nine lines character for character, which made this
 * the seam where a new room-level notice would have to be added three times.
 */
interface Props<P extends { id: string; name: string }> {
  /** Null when playing alone, in which case there is only the notices. */
  room: RoomHandle | null;
  players: readonly P[];
  dispatch: (action: { type: 'renamePlayer'; id: string; name: string }) => void;
  /** Set once the room has gone, so it can be said rather than just happening. */
  gone: GoneReason | null;
}

export function RoomStrip<P extends { id: string; name: string }>({
  room,
  players,
  dispatch,
  gone,
}: Props<P>) {
  return (
    <>
      {room && (
        <RoomBar
          room={room}
          onLeave={room.leave}
          myName={myName(room, players)}
          onRename={renameSelf(room, dispatch)}
        />
      )}
      <RoomNotices lastError={room?.lastError} gone={gone} />
    </>
  );
}
