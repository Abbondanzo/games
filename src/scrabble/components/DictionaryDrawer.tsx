import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { DictEntry } from '../lib/dictionary';
import { useLookup } from '../lib/useLookup';
import { ValidityBar } from './ValidityBar';

interface Props {
  initialWord: string;
  onClose: () => void;
}

export function DictionaryDrawer({ initialWord, onClose }: Props) {
  const [term, setTerm] = useState(initialWord);
  const { view, check } = useLookup();
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<(word: string) => void>(() => {});

  function search(raw: string) {
    const word = raw.trim().replace(/[^A-Za-z'-]/g, '');
    if (!word) return;
    void check(word);
  }
  searchRef.current = search;

  // Close on Escape from anywhere in the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Run the prefilled word once on open, and take focus.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    if (initialWord) searchRef.current(initialWord);
  }, [initialWord]);

  function submit(event: FormEvent) {
    event.preventDefault();
    search(term);
  }

  return (
    <div
      className="drawer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel" role="dialog" aria-modal="true" aria-label="Dictionary">
        <div className="card-head">
          <h2>Dictionary</h2>
          <button type="button" className="link icon-link" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" /> Close
          </button>
        </div>

        <form className="row" onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Look up a word…"
            aria-label="Word to look up"
            autoComplete="off"
          />
          <button type="submit" className="primary">
            Look up
          </button>
        </form>

        <div className="dict-result" aria-live="polite">
          <ValidityBar view={view} />
          {view.kind === 'valid' && <Entry entries={view.entries} />}
        </div>

        <p className="hint">
          Definitions come from a free online dictionary, so this needs an internet connection. It
          is a general English dictionary rather than the official Scrabble word list, so a missing
          word means “probably not allowed”, not a ruling.
        </p>
      </div>
    </div>
  );
}

function Entry({ entries }: { entries: DictEntry[] }) {
  const entry = entries[0];
  if (!entry) return null;

  const phonetic = entry.phonetic ?? entry.phonetics?.find((p) => p.text)?.text;

  return (
    <div>
      <div>
        <span className="word">{entry.word}</span>
        {phonetic && <span className="phon">{phonetic}</span>}
      </div>
      {(entry.meanings ?? []).map((meaning, i) => (
        <div key={`${meaning.partOfSpeech}-${i}`}>
          <div className="pos">{meaning.partOfSpeech}</div>
          <ol>
            {meaning.definitions.slice(0, 3).map((d, j) => (
              <li key={j}>
                {d.definition}
                {d.example && <span className="ex">“{d.example}”</span>}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}
