import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { LookupView } from '../lib/lookupView';

const ICON_PROPS = { size: 18, strokeWidth: 2, 'aria-hidden': true as const, className: 'mark' };

/**
 * The verdict bar: green when the word list has the word, red when it doesn't.
 * Amber is now only for a list that could not be read, which is why it says
 * "couldn't check" rather than anything about the word.
 */
export function ValidityBar({ view }: { view: LookupView }) {
  if (view.kind === 'idle') return null;

  if (view.kind === 'loading') {
    return (
      <div className="validity loading" role="status">
        <LoaderCircle {...ICON_PROPS} className="mark spin" />
        <span>Looking up {view.word}…</span>
      </div>
    );
  }

  if (view.kind === 'error') {
    return (
      <div className="validity error" role="status">
        <TriangleAlert {...ICON_PROPS} />
        <span>
          <b>Couldn’t check {view.word}.</b> {view.message}
        </span>
      </div>
    );
  }

  if (view.kind === 'invalid') {
    return (
      <div className="validity invalid" role="status">
        <CircleX {...ICON_PROPS} />
        <span>
          <span className="word">{view.word}</span> is not in the dictionary.
        </span>
      </div>
    );
  }

  // `detail` arrives after the verdict, or not at all. The sentence has to read
  // properly either way, so the definition is a separate node rather than
  // interpolated text that would leave a stray space when there isn't one.
  return (
    <div className="validity valid" role="status">
      <CircleCheck {...ICON_PROPS} />
      <span>
        <span className="word">{view.word}</span> is a valid word.
        {view.detail && <span className="detail"> {view.detail}</span>}
      </span>
    </div>
  );
}
