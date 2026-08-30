import { DefinitionResponseSchema, type DefinitionEntry } from '@shared/dictionary';
import { ROOMS_URL } from '../../rooms/transport';

/**
 * The room server normalises the dictionary's shape, so this is the shape both
 * sides agree on rather than anything Merriam-Webster returns.
 */
export type DictEntry = DefinitionEntry;

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
 *
 * `timeoutMs` is the deadline for a single attempt and `budgetMs` for the whole
 * lookup. Without them a request that is accepted and then never answered - the
 * upstream's other failure mode, and worse than a 502 because nothing rejects -
 * leaves the spinner turning for as long as the page is open.
 *
 * Exported so tests can run the retry and timeout paths without real delays.
 */
export const retryConfig = { rounds: 3, delayMs: 250, timeoutMs: 6_000, budgetMs: 15_000 };

const cancelled = () => new DOMException('The lookup was cancelled.', 'AbortError');

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}

/** A backoff that a cancelled lookup does not have to sit through. */
const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * One attempt's signal: the caller's cancellation, plus a deadline of our own.
 * Built by hand rather than with `AbortSignal.any`, which iOS Safari only
 * gained in 17.4 and this is a phone app.
 */
function deadline(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const attempt = {
    signal: controller.signal,
    /** Set when our own deadline fired, which is retryable rather than a cancellation. */
    expired: false,
    release: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };

  const onAbort = () => controller.abort();
  const timer = setTimeout(() => {
    attempt.expired = true;
    controller.abort();
  }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });

  return attempt;
}

/**
 * The dictionary is asked through the room server, which holds the API key.
 * That also ends the CORS problem the old direct call had: this is our own
 * origin answering, so there is no third party to be blocked by and no reverse
 * proxy to fall back to.
 */
const endpoint = (word: string): string => `${ROOMS_URL}/define/${encodeURIComponent(word)}`;

const cache = new Map<string, LookupResult>();

const SLOW =
  'The dictionary is taking too long to answer - it may still be a perfectly valid word. Try again in a moment.';

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

export async function lookup(rawWord: string, signal?: AbortSignal): Promise<LookupResult> {
  const word = rawWord.trim().toLowerCase();
  const cached = cache.get(word);
  if (cached) return cached;

  throwIfCancelled(signal);

  const url = endpoint(word);
  const startedAt = Date.now();
  const spent = () => Date.now() - startedAt >= retryConfig.budgetMs;
  let attempted = false;
  let lastError: unknown;

  for (let round = 0; round < retryConfig.rounds; round++) {
    if (round > 0) await delay(retryConfig.delayMs * 2 ** (round - 1), signal);
    throwIfCancelled(signal);

    // The budget only applies once something has actually been tried, so a
    // clock skewed forward can never turn a lookup into a no-op.
    if (attempted && spent()) break;
    attempted = true;

    const attempt = deadline(signal, retryConfig.timeoutMs);
    try {
      const res = await fetch(url, { signal: attempt.signal });

      if (!res.ok) {
        // The status is kept for debugging but deliberately not shown. A 404
        // here means the room server has never heard of this route - one
        // deployed before definitions existed - not that the word is absent.
        lastError = new DictionaryError(
          'The dictionary didn’t answer - it may still be a perfectly valid word. Try again in a moment.',
          res.status,
        );
        continue;
      }

      // Inside the deadline as well: headers can arrive and the body still hang.
      const body = DefinitionResponseSchema.safeParse(await res.json());
      if (!body.success) {
        lastError = new DictionaryError('The dictionary’s answer could not be read.');
        continue;
      }

      // No entries is an answer: the dictionary has nothing for this word.
      // Cached like any other answer, because it will not change.
      const result: LookupResult = body.data.entries.length
        ? { status: 'found', word, entries: body.data.entries }
        : { status: 'missing', word };
      cache.set(word, result);
      return result;
    } catch (err) {
      // Our deadline, not the caller's cancellation: a hung request says
      // nothing about the word, so it is retried like any other failure.
      if (attempt.expired) {
        lastError = new DictionaryError(SLOW);
        continue;
      }
      if (isAbort(err)) throw err;
      lastError = err;
    } finally {
      attempt.release();
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
