import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayersCard } from './PlayersCard';

const PLAYERS = [
  { id: 'a', name: 'Ada' },
  { id: 'g', name: 'Grace' },
];

const setup = (editable?: boolean) => {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  render(
    <PlayersCard players={PLAYERS} onAdd={onAdd} onRemove={onRemove} editable={editable}>
      <p>scoreboard</p>
    </PlayersCard>,
  );
  return { onAdd, onRemove };
};

describe('editable roster', () => {
  it('offers the add form and remove buttons by default', async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.type(screen.getByLabelText('Player name'), 'Alan');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledWith('Alan');
    expect(screen.getByRole('button', { name: 'Remove Ada' })).toBeInTheDocument();
  });
});

describe('read-only roster', () => {
  // Someone who joined a room can see who is playing but cannot change it.
  it('hides the editor entirely rather than disabling it', () => {
    setup(false);

    expect(screen.queryByLabelText('Player name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Ada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit|Done/ })).not.toBeInTheDocument();
  });

  it('still shows the scoreboard', () => {
    setup(false);
    expect(screen.getByText('scoreboard')).toBeInTheDocument();
  });

  // With no players the editor normally forces itself open; it must not do that
  // for someone who has no business editing.
  it('stays closed even with no players yet', () => {
    render(<PlayersCard players={[]} onAdd={vi.fn()} onRemove={vi.fn()} editable={false} />);
    expect(screen.queryByLabelText('Player name')).not.toBeInTheDocument();
  });
});
