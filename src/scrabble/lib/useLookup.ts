import { useCallback, useEffect, useRef, useState } from 'react';
import { runDefinition, runVerdict, type LookupView } from './lookupView';
import { loadWordList } from './words';

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

  /**
   * The verdict first, from the list, then the definition once the dictionary
   * answers. In that order because the verdict is the part that must not wait
   * on a network - it lands immediately and the definition fills in beneath it,
   * or does not, which is only ever a missing sentence rather than a missing
   * ruling.
   */
  const check = useCallback(
    async (rawWord: string) => {
      cancel();
      const controller = new AbortController();
      inFlight.current = controller;
      setView({ kind: 'loading', word: rawWord.trim().toUpperCase() });
      try {
        const verdict = await runVerdict(rawWord);
        if (controller.signal.aborted) return;
        setView(verdict);
        if (verdict.kind !== 'valid') return;

        const definition = await runDefinition(rawWord, controller.signal);
        if (definition && !controller.signal.aborted) setView({ ...verdict, ...definition });
      } catch {
        // Only an abort reaches here, and it is never this lookup's to report.
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
    [cancel],
  );

  useEffect(() => {
    // Warm the list while somebody is still typing. It is a megabyte to decode,
    // and paying that on mount rather than on the first Check is the difference
    // between a verdict that feels instant and one that does not.
    void loadWordList();
    // A lookup outliving its component would set state on an unmounted one.
    return cancel;
  }, [cancel]);

  return { view, check, clear, show };
}
