export interface Definition {
  definition: string;
  example?: string;
}

export interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
}

export interface DictEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: Meaning[];
}

export type LookupResult =
  { status: 'found'; word: string; entries: DictEntry[] } | { status: 'missing'; word: string };

export class DictionaryError extends Error {
  /** HTTP status, when the failure came back as a response rather than a throw. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/**
 * The upstream serves sporadic 502s that have nothing to do with the word -
 * "ax" and "za" have both been seen to 502 once and then resolve on a retry.
 * Only 200 and 404 carry meaning, so anything else is retried before giving up.
 * Exported so tests can run the retry path without real delays.
 */
export const retryConfig = { rounds: 3, delayMs: 250 };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const API = 'https://api.dictionaryapi.dev/api/v2/entries/en';

/** A CORS reverse proxy, tried only if the direct call fails. */
const CORS_PROXY = 'https://cors.abbondanzo.workers.dev';

/**
 * The API sends `Access-Control-Allow-Origin: *`, so the browser can call it
 * directly from any http(s) origin - which is why this has to be served rather
 * than opened as a file. The proxy covers the case where that call is blocked.
 */
function endpoints(word: string): string[] {
  const direct = `${API}/${encodeURIComponent(word)}`;
  return [direct, `${CORS_PROXY}/${direct}`];
}

const cache = new Map<string, LookupResult>();

/**
 * Plain-English failure text. Players are not developers: never show a status
 * code or a raw error, and never imply the word itself is at fault.
 */
function describeFailure(err: unknown): string {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return 'The dictionary is unavailable when this page is opened straight from a file. Start the app and use the web address it gives you.';
  }
  if (err instanceof TypeError) {
    return 'Couldn’t reach the dictionary. Check your internet connection and try again.';
  }
  return 'The dictionary is unavailable right now. Please try again in a moment.';
}

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

export async function lookup(rawWord: string, signal?: AbortSignal): Promise<LookupResult> {
  const word = rawWord.trim().toLowerCase();
  const cached = cache.get(word);
  if (cached) return cached;

  const urls = endpoints(word);
  let lastError: unknown;

  for (let round = 0; round < retryConfig.rounds; round++) {
    if (round > 0) await delay(retryConfig.delayMs * 2 ** (round - 1));

    for (const url of urls) {
      let res: Response;
      try {
        res = await fetch(url, { signal });
      } catch (err) {
        if (isAbort(err)) throw err;
        lastError = err; // Try the next endpoint (the CORS proxy) before giving up.
        continue;
      }

      // 404 is the only signal that a word genuinely isn't there. Trust it
      // immediately - no retry, and cache it.
      if (res.status === 404) {
        const miss: LookupResult = { status: 'missing', word };
        cache.set(word, miss);
        return miss;
      }

      if (!res.ok) {
        // The status is kept for debugging but deliberately not shown.
        lastError = new DictionaryError(
          'The dictionary didn’t answer - it may still be a perfectly valid word. Try again in a moment.',
          res.status,
        );
        continue;
      }

      const entries = (await res.json()) as DictEntry[];
      const hit: LookupResult = { status: 'found', word, entries };
      cache.set(word, hit);
      return hit;
    }
  }

  // Never cached: a failure here is about the service, not the word.
  throw lastError instanceof DictionaryError
    ? lastError
    : new DictionaryError(describeFailure(lastError));
}

/** Exposed for tests so cached results don't leak between cases. */
export const clearDictionaryCache = (): void => cache.clear();

export const firstDefinition = (entries: DictEntry[]): string => {
  const meaning = entries[0]?.meanings?.[0];
  const def = meaning?.definitions?.[0]?.definition;
  if (!def) return 'Found in the dictionary.';
  return meaning?.partOfSpeech ? `(${meaning.partOfSpeech}) ${def}` : def;
};
