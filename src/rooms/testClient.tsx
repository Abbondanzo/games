/**
 * A client, for tests. The other half of `testRoom.ts`.
 *
 * Rendering one takes the same eight lines every time - a container of its own
 * so several clients can be on screen at once, a router, and the overrides that
 * decide whether this device is in a room. That was written out five times, and
 * reading the board out of one was written out seven.
 *
 * Test-only, and beside the code it stands in for, as `testRoom.ts` is.
 */
import { render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentType } from 'react';
import { RoomProvider, type RoomOverrides } from './RoomProvider';
import type { TestRoom } from './testRoom';
import type { StoredSession } from './storage';
import type { TransportFactory } from './transport';

export interface MountOptions {
  /** The room to wire this client to. Left out for a game played alone. */
  room?: TestRoom;
  /**
   * Which member this device is. Defaults to the room's host when a room is
   * given. Explicitly null means play alone; leaving the key out entirely with
   * a transport of your own means the app reads its own stored session, which
   * is what a real page load does.
   */
  session?: StoredSession | null;
  /** Names the container, so several clients on screen stay apart. */
  label?: string;
  /** Pretends the room is running a different protocol version. */
  protocol?: number;
  /** A transport of the test's own, for a room that refuses or never answers. */
  transport?: TransportFactory;
}

/**
 * Renders one tracker and hands back its container. Scope every query to it:
 * with a host and a guest both on screen, an unscoped query finds two of
 * everything.
 */
export function mountClient(Tracker: ComponentType, options: MountOptions = {}): HTMLElement {
  const container = document.createElement('div');
  if (options.label) container.dataset.client = options.label;
  document.body.append(container);

  const value: RoomOverrides = {};
  const transport =
    options.transport ??
    options.room?.transport(
      options.protocol === undefined ? undefined : { protocol: options.protocol },
    );
  if (transport) value.transport = transport;

  if ('session' in options) value.session = options.session;
  else if (options.room) value.session = options.room.hostSession;
  else if (!options.transport) value.session = null;

  render(
    <RoomProvider value={value}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Tracker />
      </MemoryRouter>
    </RoomProvider>,
    { container },
  );
  return container;
}

/** Host and guest in one call, which is how most of these tests start. */
export function mountPair(
  Tracker: ComponentType,
  room: TestRoom,
  guest: StoredSession,
): { host: HTMLElement; guest: HTMLElement } {
  return {
    host: mountClient(Tracker, { room, label: 'host' }),
    guest: mountClient(Tracker, { room, session: guest, label: 'guest' }),
  };
}

/* ─────────────────────────── reading the board ─────────────────────────── */

/**
 * The one place that reaches for class names instead of roles.
 *
 * A scoreboard row has no accessible structure to separate the name from the
 * score - to a screen reader it is one run of text - so there is nothing to
 * query by. Keeping the exception in a single function means a class rename
 * breaks one file rather than seven, and means the rule is broken on purpose
 * rather than by habit.
 */
const rows = (client: HTMLElement = document.body): HTMLElement[] =>
  within(client)
    .getAllByRole('listitem')
    .filter((li) => li.querySelector('.pts'));

const text = (row: HTMLElement, selector: string): string =>
  row.querySelector(selector)?.textContent ?? '';

/** Every row as "Ada:22", in the order the board shows them. */
export const scoreboard = (client?: HTMLElement): string[] =>
  rows(client).map((li) => `${text(li, '.name')}:${text(li, '.pts')}`);

/** Just the names, for when the scores are not the point. */
export const playerNames = (client?: HTMLElement): string[] =>
  rows(client).map((li) => text(li, '.name'));

/** The row marked as this device's own, if there is one. */
export const myRow = (client?: HTMLElement): HTMLElement | undefined =>
  rows(client).find((li) => li.querySelector('.you'));

/**
 * The headings of a board laid out in columns, which is where cricket and
 * Yahtzee put their players. Scoped to the head of the table on purpose: a
 * heading spanning a section further down is a column header too, and would
 * otherwise arrive here as a player with no name.
 */
const headings = (client: HTMLElement): HTMLElement[] => {
  const head = within(client).getByRole('table').querySelector('thead');
  return head ? within(head as HTMLElement).getAllByRole('columnheader') : [];
};

export const boardColumns = (client: HTMLElement): string[] =>
  headings(client)
    .slice(1)
    .map((h) => h.querySelector('.name')?.textContent ?? '');

/**
 * The bottom row of a board laid out in columns, as "Ada:65": cricket points,
 * Yahtzee totals. Same exception as the rows above, for the same reason - a
 * total sits in a cell with no accessible structure tying it to its column.
 */
export const boardTotals = (client: HTMLElement): string[] => {
  const table = within(client).getByRole('table');
  const names = boardColumns(client);
  const totals = [...(table.querySelector('tfoot')?.querySelectorAll('.pts') ?? [])].map(
    (cell) => cell.textContent ?? '',
  );
  return names.map((name, i) => `${name}:${totals[i] ?? ''}`);
};

/** The cricket column marked as this device's own. */
export const myColumn = (client: HTMLElement): HTMLElement | undefined =>
  headings(client).find((h) => h.querySelector('.you'));

/* ─────────────────────────── watching for sockets ─────────────────────────── */

/**
 * Counts every socket the app tries to open. Solo play must never open one, and
 * a room that has ended must not be retried, so several tests need to know.
 */
export function countingSockets(): { count: () => number; restore: () => void } {
  const original = globalThis.WebSocket;
  let count = 0;
  // @ts-expect-error - stands in for the real thing for the duration
  globalThis.WebSocket = class {
    constructor() {
      count += 1;
    }
  };
  return {
    count: () => count,
    restore: () => {
      globalThis.WebSocket = original;
    },
  };
}
