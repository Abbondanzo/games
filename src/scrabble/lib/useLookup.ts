import { useCallback, useEffect, useRef, useState } from 'react';
import { runLookup, type LookupView } from './lookupView';

const IDLE: LookupView = { kind: 'idle' };

/**
 * A dictionary lookup that can only ever land while it is still wanted.
 *
 * Both callers have several ways out of a lookup - typing on, banking a word,
 * passing, scoring the turn, closing the drawer, searching for something else -
 * and each one has to cancel the request in flight as well as clear the bar.
 * Otherwise a verdict for a word nobody is looking at any more arrives late and
 * overwrites the bar, which is the bug this hook exists to make impossible.
 */
export function useLookup() {
  const [view, setView] = useState<LookupView>(IDLE);
  const inFlight = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  /** Cancel whatever is running and put the bar back to nothing. */
  const clear = useCallback(() => {
    cancel();
    setView(IDLE);
  }, [cancel]);

  /** Cancel whatever is running and say something else instead. */
  const show = useCallback(
    (next: LookupView) => {
      cancel();
      setView(next);
    },
    [cancel],
  );

  const check = useCallback(
    async (rawWord: string) => {
      cancel();
      const controller = new AbortController();
      inFlight.current = controller;
      setView({ kind: 'loading', word: rawWord.trim().toUpperCase() });
      try {
        const result = await runLookup(rawWord, controller.signal);
        if (!controller.signal.aborted) setView(result);
      } catch {
        // Only an abort reaches here, and it is never this lookup's to report.
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
    [cancel],
  );

  // A lookup outliving its component would set state on an unmounted one.
  useEffect(() => cancel, [cancel]);

  return { view, check, clear, show };
}
