/**
 * Joining a table the host laid out in advance.
 *
 * A host often sets the room up before anyone arrives, typing everybody in. The
 * rows are there to be taken, so a joiner is offered them before being asked
 * for a name - which is the point: by the time you have typed one, you have
 * made a second player.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinRoom } from './JoinRoom';
import { mountClient } from './testClient';
import * as api from './api';

const WAITING = [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Grace' }];

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Stops the reload that a real join performs. */
const stubReload = () => {
  const reload = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
  return reload;
};

const peekReturns = (claimable: { id: string; name: string }[]) =>
  vi.spyOn(api, 'peekRoom').mockResolvedValue({
    ok: true, value: { game: 'cricket', open: true, claimable },
  });

const joinSucceeds = () =>
  vi.spyOn(api, 'joinRoom').mockResolvedValue({
    ok: true, value: { game: 'cricket', code: 'AB23', token: 't', memberId: 'm' },
  });

async function enterCode(user: ReturnType<typeof userEvent.setup>) {
  mountClient(JoinRoom);
  await user.type(screen.getByLabelText('Room code'), 'AB23');
}

describe('being offered the players already set up', () => {
  it('shows them as soon as the code is a code', async () => {
    const user = userEvent.setup();
    peekReturns(WAITING);
    await enterCode(user);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Join as Ada' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Join as Grace' })).toBeInTheDocument();
  });

  it('offers nothing before the code is complete', async () => {
    const user = userEvent.setup();
    const peek = peekReturns(WAITING);
    mountClient(JoinRoom);
    await user.type(screen.getByLabelText('Room code'), 'AB');

    expect(peek).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Join as/ })).not.toBeInTheDocument();
  });

  it('says nothing when the host laid nothing out', async () => {
    const user = userEvent.setup();
    peekReturns([]);
    await enterCode(user);

    await waitFor(() => expect(api.peekRoom).toHaveBeenCalled());
    expect(screen.queryByText(/Has the host already added you/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
  });

  // Before the name, because after it you have already made a second player.
  it('asks the question before asking for a name', async () => {
    const user = userEvent.setup();
    peekReturns(WAITING);
    await enterCode(user);

    await waitFor(() => expect(screen.getByText(/Has the host already added you/)).toBeInTheDocument());
    const question = screen.getByText(/Has the host already added you/);
    const nameField = screen.getByLabelText('Your name');
    // eslint-disable-next-line no-bitwise
    const order = question.compareDocumentPosition(nameField);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('claiming one', () => {
  it('joins as that player, with no name typed at all', async () => {
    const user = userEvent.setup();
    peekReturns(WAITING);
    const join = joinSucceeds();
    stubReload();
    await enterCode(user);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Join as Grace' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Join as Grace' }));

    await waitFor(() => expect(join).toHaveBeenCalledWith('AB23', 'Grace', expect.any(String), 'p2'));
  });

  it('sends the device secret with it, as any join does', async () => {
    const user = userEvent.setup();
    peekReturns(WAITING);
    const join = joinSucceeds();
    stubReload();
    await enterCode(user);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Join as Ada' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Join as Ada' }));

    await waitFor(() => expect(join).toHaveBeenCalled());
    const secret = join.mock.calls[0]![2];
    expect(secret.length).toBeGreaterThanOrEqual(24);
  });

  it('remembers the name it claimed, for next time', async () => {
    const user = userEvent.setup();
    peekReturns(WAITING);
    joinSucceeds();
    stubReload();
    await enterCode(user);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Join as Ada' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Join as Ada' }));

    await waitFor(() => expect(localStorage.getItem('games.name.v1')).toBe('Ada'));
  });

  it('says what went wrong rather than going quiet', async () => {
    const user = userEvent.setup();
    peekReturns(WAITING);
    vi.spyOn(api, 'joinRoom').mockResolvedValue({ ok: false, error: 'kicked-out' });
    await enterCode(user);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Join as Ada' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Join as Ada' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('removed you from this game'));
  });
});

describe('adding yourself instead', () => {
  it('still works with players waiting', async () => {
    const user = userEvent.setup();
    peekReturns(WAITING);
    const join = joinSucceeds();
    stubReload();
    await enterCode(user);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Join as Ada' })).toBeInTheDocument());
    await user.type(screen.getByLabelText('Your name'), 'Alan');
    await user.click(screen.getByRole('button', { name: /^Join$/ }));

    await waitFor(() => expect(join).toHaveBeenCalledWith('AB23', 'Alan', expect.any(String), null));
  });
});
