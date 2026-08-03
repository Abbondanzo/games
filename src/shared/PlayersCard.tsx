import { useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  players: { id: string; name: string }[];
  onAdd: (names: string) => void;
  onRemove: (id: string) => void;
  /** Rendered in the card header, e.g. a game-mode toggle. */
  headerExtra?: ReactNode;
  /** The game's own scoreboard, shown under the editor. */
  children?: ReactNode;
  /**
   * When false the roster is read-only: no add form, no remove buttons, no
   * edit toggle. Used for players in a room who are not the host.
   */
  editable?: boolean;
}

/**
 * Adding and removing players. Shared by every game so the setup step behaves
 * identically throughout; each game supplies its own scoreboard as children.
 */
export function PlayersCard({
  players, onAdd, onRemove, headerExtra, children, editable = true,
}: Props) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(true);
  const open = editable && (editing || players.length === 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd(name);
    setName('');
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Players</h2>
        {headerExtra}
        {editable && players.length > 0 && (
          <button type="button" className="link" onClick={() => setEditing((v) => !v)}>
            {open ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {open && (
        <div>
          <form className="row" onSubmit={submit}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Add a player and press Enter"
              aria-label="Player name"
              autoComplete="off"
              maxLength={24}
            />
            <button type="submit" className="primary">Add</button>
          </form>

          <ul className="chips">
            {players.map((p) => (
              <li key={p.id}>
                {p.name}
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onRemove(p.id)}>
                  <X size={14} strokeWidth={2.5} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">Tip: paste names separated by commas to add several at once.</p>
        </div>
      )}

      {children}
    </section>
  );
}
