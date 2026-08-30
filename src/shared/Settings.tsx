import { useState } from 'react';
import { Moon, Sun, SunMoon, type LucideIcon } from 'lucide-react';
import { TopBar } from './TopBar';
import { readTheme, setTheme, type Theme } from './theme';
import { clearName, readName, writeName } from '../rooms/storage';

/**
 * The two things this device remembers that are not a game: how it paints, and
 * the name it plays under. Both are answered here rather than at the door,
 * because the door is a bad place to change your mind - the name is offered
 * there in the middle of joining, and until now the only way to be rid of one
 * was to type over it.
 */
interface Choice {
  value: Theme;
  label: string;
  Icon: LucideIcon;
}

const THEMES: Choice[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'auto', label: 'Automatic', Icon: SunMoon },
];

export function Settings() {
  const [theme, setPick] = useState(readTheme);
  const [name, setName] = useState(readName);

  function choose(next: Theme) {
    setPick(next);
    setTheme(next);
  }

  /** Written as it is typed: a settings page with a Save button is a trap. */
  function rename(next: string) {
    setName(next);
    writeName(next);
  }

  function forget() {
    setName('');
    clearName();
  }

  return (
    <>
      <TopBar title="Settings" />
      <main className="home">
        <p className="sub">Kept on this device, and never shared with anyone you play with.</p>

        <section className="card settings-card">
          <div className="card-head">
            <h2>Appearance</h2>
          </div>
          <div className="seg" role="group" aria-label="Colour scheme">
            {THEMES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                className={theme === value ? 'on' : undefined}
                aria-pressed={theme === value}
                onClick={() => choose(value)}
              >
                <Icon size={15} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          <p className="hint">Automatic follows whatever this device is set to.</p>
        </section>

        <section className="card settings-card">
          <div className="card-head">
            <h2>Your name</h2>
          </div>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => rename(e.target.value)}
              maxLength={24}
              autoComplete="off"
            />
          </label>
          <p className="hint">
            Filled in for you when you host or join a game someone is sharing. You can still change
            it there.
          </p>
          {name.trim() && (
            <button type="button" className="ghost" onClick={forget}>
              Forget this name
            </button>
          )}
        </section>
      </main>
    </>
  );
}
