import { createContext, useContext, type ReactNode } from 'react';
import type { TransportFactory } from './transport';
import type { StoredSession } from './storage';

/**
 * Overrides for how a tracker reaches its room.
 *
 * Production supplies none, so the defaults apply: a real WebSocket, and
 * whichever session this device has stored. Tests supply both, which is what
 * lets two clients be rendered side by side against one in-process room.
 */
export interface RoomOverrides {
  transport?: TransportFactory;
  /** Explicitly null means "play alone", as distinct from "not overridden". */
  session?: StoredSession | null;
}

const RoomContext = createContext<RoomOverrides>({});

export const RoomProvider = ({ value, children }: { value: RoomOverrides; children: ReactNode }) => (
  <RoomContext.Provider value={value}>{children}</RoomContext.Provider>
);

export const useRoomOverrides = (): RoomOverrides => useContext(RoomContext);
