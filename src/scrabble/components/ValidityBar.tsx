import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { LookupView } from '../lib/lookupView';

const ICON_PROPS = { size: 18, strokeWidth: 2, 'aria-hidden': true as const, className: 'mark' };

/**
 * The verdict bar: green when the dictionary has the word, red when it
 * definitively doesn't, amber when we couldn't get an answer at all.
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
        <span><b>Couldn’t check {view.word}.</b> {view.message}</span>
      </div>
    );
  }

  if (view.kind === 'invalid') {
    return (
      <div className="validity invalid" role="status">
        <CircleX {...ICON_PROPS} />
        <span><span className="word">{view.word}</span> is not in the dictionary.</span>
      </div>
    );
  }

  return (
    <div className="validity valid" role="status">
      <CircleCheck {...ICON_PROPS} />
      <span><span className="word">{view.word}</span> is a valid word. {view.detail}</span>
    </div>
  );
}
