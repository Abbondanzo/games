import { DictionaryError, type DictEntry, firstDefinition, lookup } from './dictionary';

/**
 * What the UI shows for a lookup. `invalid` means the dictionary answered and
 * the word is not in it; `error` means we never got an answer, which says
 * nothing about the word either way. Keeping those apart is the whole point.
 */
export type LookupView =
  | { kind: 'idle' }
  | { kind: 'loading'; word: string }
  | { kind: 'valid'; word: string; detail: string; entries: DictEntry[] }
  | { kind: 'invalid'; word: string }
  | { kind: 'error'; word: string; message: string };

/**
 * Rejects with an `AbortError` when `signal` fires, rather than resolving to a
 * view: a cancelled lookup has no verdict to show, and whatever cancelled it
 * owns the bar now.
 */
export async function runLookup(rawWord: string, signal?: AbortSignal): Promise<LookupView> {
  const word = rawWord.trim().toUpperCase();
  try {
    const result = await lookup(rawWord, signal);
    return result.status === 'missing'
      ? { kind: 'invalid', word }
      : { kind: 'valid', word, detail: firstDefinition(result.entries), entries: result.entries };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return {
      kind: 'error',
      word,
      message: err instanceof DictionaryError ? err.message : 'The lookup failed unexpectedly.',
    };
  }
}
