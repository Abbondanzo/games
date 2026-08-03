const WORDS = ['no marks', 'one mark', 'two marks', 'closed'] as const;

/**
 * Cricket scoreboard notation, drawn rather than typed so it looks the same in
 * every font: one mark is a stroke, two a cross, three a ringed cross.
 */
export function MarkGlyph({ marks }: { marks: number }) {
  const n = Math.max(0, Math.min(3, marks)) as 0 | 1 | 2 | 3;

  return (
    <span className={`mark-glyph m${n}`} title={WORDS[n]}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
        {n === 0 && <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />}
        {n >= 1 && <line x1="4.5" y1="15.5" x2="15.5" y2="4.5" />}
        {n >= 2 && <line x1="4.5" y1="4.5" x2="15.5" y2="15.5" />}
        {n === 3 && <circle cx="10" cy="10" r="8.25" fill="none" />}
      </svg>
      <span className="sr-only">{WORDS[n]}</span>
    </span>
  );
}
