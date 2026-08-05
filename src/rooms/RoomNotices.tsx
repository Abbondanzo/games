import { useState } from 'react';
import {
  GONE_MESSAGES,
  describeError,
  type ErrorCode,
  type GoneReason,
} from '@shared/rooms/protocol';

/**
 * The two things a room needs to say for itself: that it refused something, and
 * that it is over. Both look the same wherever they appear, so all three games
 * render this rather than each keeping their own copy.
 */
interface Props {
  /** The room's last refusal, or null. Absent entirely when playing alone. */
  lastError?: ErrorCode | null;
  /** Set once the room has gone, which is when there is no room left to ask. */
  gone: GoneReason | null;
}

export function RoomNotices({ lastError, gone }: Props) {
  // Ending a room is a one-off event, not a state to sit in, so this can be
  // put away. Keyed on the reason, so a later one still gets said.
  const [dismissed, setDismissed] = useState<GoneReason | null>(null);

  return (
    <>
      {lastError && (
        <div className="banner warn" role="status">
          {describeError(lastError)}
        </div>
      )}

      {gone && dismissed !== gone && (
        <div className="banner warn" role="status">
          <span>{GONE_MESSAGES[gone]}</span>
          <button type="button" className="link" onClick={() => setDismissed(gone)}>
            Hide
          </button>
        </div>
      )}
    </>
  );
}
