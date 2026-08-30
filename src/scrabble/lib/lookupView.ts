import { type DictEntry, firstDefinition, lookup } from './dictionary';
import { loadWordList } from './words';

/**
 * What the UI shows for a lookup.
 *
 * `valid` and `invalid` come from the offline word list, so they are decided
 * without a network call and never depend on one. `detail` is the definition,
 * which does: it is null until the dictionary answers, and stays null if it
 * never does. A missing definition is not a verdict and must not read as one.
 *
 * `error` is now only for a word list that could not be read at all, which
 * should not happen - it is precached - but must not silently mean "not a word".
 */
export type LookupView =
  | { kind: 'idle' }
  | { kind: 'loading'; word: string }
  | { kind: 'valid'; word: string; detail: string | null; entries: DictEntry[] }
  | { kind: 'invalid'; word: string }
  | { kind: 'error'; word: string; message: string };

export const isAbort = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'AbortError';

/** The verdict, from the list. Offline, instant, and the same every time. */
export async function runVerdict(rawWord: string): Promise<LookupView> {
  const word = rawWord.trim().toUpperCase();
  try {
    const words = await loadWordList();
    return words.has(rawWord.trim().toLowerCase())
      ? { kind: 'valid', word, detail: null, entries: [] }
      : { kind: 'invalid', word };
  } catch {
    return {
      kind: 'error',
      word,
      message: 'The word list could not be read. Reload the page and try again.',
    };
  }
}

/**
 * The definition, from the dictionary. Returns null when there isn't one to
 * show - the word is absent upstream, or the service never answered. Neither
 * says anything about validity any more, so neither is worth alarming anyone
 * with. Cancellation still propagates, because a stale definition is worse than
 * none.
 */
export async function runDefinition(
  rawWord: string,
  signal?: AbortSignal,
): Promise<{ detail: string; entries: DictEntry[] } | null> {
  try {
    const result = await lookup(rawWord, signal);
    if (result.status === 'missing') return null;
    return { detail: firstDefinition(result.entries), entries: result.entries };
  } catch (err) {
    if (isAbort(err)) throw err;
    return null;
  }
}
