/**
 * The questions every tracker asks about the room it may or may not be in.
 *
 * Each of them has to answer for a solo game too, where there is no room, no
 * host and nobody else waiting: the honest answer there is that you can do
 * everything, and it is the answer that is easiest to get subtly wrong. Three
 * trackers asking the same question three slightly different ways is how they
 * drift apart, so they ask here instead.
 */
import type { RoomHandle } from './session';

/** The little of a player these need: enough to find yours and read its name. */
interface Named {
  id: string;
  name: string;
}

/** Playing alone there is no host, so the one person playing counts as one. */
export const isHost = (room: RoomHandle | null): boolean => !room || room.role === 'host';

/** The player this device enters scores for. Null when watching, or alone. */
export const mySeat = <P extends Named>(
  room: RoomHandle | null,
  players: readonly P[],
): P | null => (room?.seatId ? players.find((p) => p.id === room.seatId) ?? null : null);

export const myName = <P extends Named>(
  room: RoomHandle | null,
  players: readonly P[],
): string | null => mySeat(room, players)?.name ?? null;

/**
 * Whether the turn on the board belongs to this device.
 *
 * Null when playing alone: every turn is yours, so saying so is noise. That is
 * a third answer rather than `true` on purpose - the callers show different
 * wording for "your turn" than for a game with only one person in it.
 */
export const isMyTurn = (
  room: RoomHandle | null,
  currentPlayerId: string | null,
): boolean | null => (room ? currentPlayerId !== null && currentPlayerId === room.seatId : null);

/**
 * Whether an entry control should be closed off: either the room would refuse
 * this action, or it is still waiting on the last one. Never closed when alone.
 */
export const blocked = (room: RoomHandle | null, actionType: string): boolean =>
  (room ? !room.can(actionType) || room.sending : false);

/**
 * Whether to offer a control at all. Where `blocked` disables, this hides: for
 * something the room will never allow this person, a disabled button that only
 * ever refuses is worse than no button.
 */
export const allowed = (room: RoomHandle | null, actionType: string): boolean =>
  (room ? room.can(actionType) : true);

/** Every game has this action, and it is the only rename a guest may make. */
interface RenameAction {
  type: 'renamePlayer';
  id: string;
  name: string;
}

/** Renaming yourself, wired to whichever seat this device holds. */
export const renameSelf = (
  room: RoomHandle | null,
  dispatch: (action: RenameAction) => void,
) => (name: string): void => {
  if (room?.seatId) dispatch({ type: 'renamePlayer', id: room.seatId, name });
};
