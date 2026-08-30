import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DictionaryError,
  clearDictionaryCache,
  firstDefinition,
  lookup,
  retryConfig,
} from './dictionary';

/**
 * The room server's shape, not Merriam-Webster's. The Worker owns the
 * translation, so nothing on this side has ever seen the upstream's fields.
 */
const entry = (word: string) => [
  {
    word,
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `meaning of ${word}` }] }],
  },
];

const okResponse = (word: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ entries: entry(word) }),
});

/** The dictionary answered and has nothing. A fine answer, and a cacheable one. */
const noEntries = { ok: true, status: 200, json: async () => ({ entries: [] }) };
const bad = (status: number) => ({ ok: false, status, json: async () => ({}) });

/** A room server that accepts the connection and never answers. */
const hangs = (_url: string, init?: { signal?: AbortSignal }) =>
  new Promise<never>((_resolve, reject) => {
    const signal = init?.signal;
    const fail = () => reject(new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });

const original = { ...retryConfig };

beforeEach(() => {
  clearDictionaryCache();
  retryConfig.delayMs = 0; // exercise the retry path without waiting
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(retryConfig, original);
});

describe('lookup', () => {
  it('returns entries for a word the dictionary has', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse('quiz')),
    );
    const result = await lookup('QUIZ');
    expect(result).toMatchObject({ status: 'found', word: 'quiz' });
  });

  it('treats an empty answer as a miss rather than an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => noEntries),
    );
    await expect(lookup('zzzz')).resolves.toMatchObject({ status: 'missing' });
  });

  it('caches results so the same word is only fetched once', async () => {
    const fetchMock = vi.fn(async () => okResponse('cat'));
    vi.stubGlobal('fetch', fetchMock);
    await lookup('cat');
    await lookup('CAT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The API key lives on the room server, so this is the only address the
  // browser may ask - never the dictionary itself, and no reverse proxy.
  it('asks the room server, and nothing else', async () => {
    const fetchMock = vi.fn(async (_url: string) => okResponse('cat'));
    vi.stubGlobal('fetch', fetchMock);
    await lookup('cat');

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/define\/cat$/);
    expect(url).not.toContain('dictionaryapi');
  });

  it('raises a DictionaryError with guidance when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(lookup('cat')).rejects.toBeInstanceOf(DictionaryError);
    await expect(lookup('cat')).rejects.toThrow(/Check your internet connection/);
  });

  it('propagates an abort rather than reporting it as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    await expect(lookup('cat')).rejects.toBeInstanceOf(DOMException);
  });

  // A room server deployed before definitions existed 404s this route. That is
  // a server too old to ask, not a word that does not exist, so it must never
  // be cached as a miss.
  it('retries a 404 rather than reading it as a word that is not there', async () => {
    const fetchMock = vi.fn(async () => bad(404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookup('quiz')).rejects.toBeInstanceOf(DictionaryError);
    expect(fetchMock).toHaveBeenCalledTimes(retryConfig.rounds);
  });

  it('refuses an answer it cannot read rather than inventing entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ entries: 'nope' }) })),
    );
    await expect(lookup('quiz')).rejects.toBeInstanceOf(DictionaryError);
  });

  // Regression: nothing bounded a single attempt, so a server that accepted the
  // connection and never answered left the lookup running until the tab closed.
  it('gives up on a request that is accepted and then never answered', async () => {
    retryConfig.timeoutMs = 5;
    const fetchMock = vi.fn(hangs);
    vi.stubGlobal('fetch', fetchMock);

    const error = await lookup('ax').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DictionaryError);
    expect((error as Error).message).toMatch(/taking too long/);
    expect(fetchMock).toHaveBeenCalledTimes(retryConfig.rounds);
  });

  it('stops retrying once the whole lookup has run out of time', async () => {
    retryConfig.timeoutMs = 10;
    retryConfig.budgetMs = 1;
    const fetchMock = vi.fn(hangs);
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookup('ax')).rejects.toBeInstanceOf(DictionaryError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // A cancellation has to reach the socket, not just stop the retry loop: the
  // request left open is the one that goes on holding the connection.
  it('cancels the request in flight when the caller aborts', async () => {
    retryConfig.timeoutMs = 1_000;
    const controller = new AbortController();
    const fetchMock = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      controller.abort(); // cancelled while this attempt is still open
      return hangs(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    const error = await lookup('ax', controller.signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not start at all when the caller has already cancelled', async () => {
    const fetchMock = vi.fn(async () => okResponse('cat'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookup('cat', AbortSignal.abort())).rejects.toBeInstanceOf(DOMException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up with guidance when every attempt fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookup('cat')).rejects.toThrow(/Check your internet connection/);
    expect(fetchMock).toHaveBeenCalledTimes(retryConfig.rounds);
  });
});

// A definition that does not arrive is a missing sentence, never a verdict, so
// none of these may be cached and none may sound like a ruling on the word.
describe('a dictionary that will not answer', () => {
  it('retries a 502 and returns the entries when it recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bad(502))
      .mockResolvedValueOnce(bad(502))
      .mockResolvedValueOnce(okResponse('ax'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookup('ax')).resolves.toMatchObject({ status: 'found' });
  });

  it('reports a persistent 502 as a service problem, never as an invalid word', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => bad(502)),
    );

    const error = await lookup('quiz').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DictionaryError);
    expect((error as DictionaryError).status).toBe(502);
    expect((error as DictionaryError).message).toMatch(/perfectly valid word/);
    expect((error as DictionaryError).message).not.toMatch(/\d{3}|HTTP|error code/i);
  });

  it('does not cache a failure, so a later attempt can still succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => bad(502)),
    );
    await expect(lookup('quiz')).rejects.toThrow();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse('quiz')),
    );
    await expect(lookup('quiz')).resolves.toMatchObject({ status: 'found' });
  });

  // Players are not developers: failure text must never leak status codes or
  // networking terms, and must never suggest the word itself was the problem.
  it('never exposes technical detail in a failure message', async () => {
    const JARGON = /\b(http|https|cors|proxy|fetch|api|localhost|server|\d{3})\b/i;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => bad(502)),
    );
    const serviceFailure = await lookup('alpha').catch((e: unknown) => (e as Error).message);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const networkFailure = await lookup('beta').catch((e: unknown) => (e as Error).message);

    retryConfig.timeoutMs = 5;
    vi.stubGlobal('fetch', vi.fn(hangs));
    const timeout = await lookup('gamma').catch((e: unknown) => (e as Error).message);

    for (const message of [serviceFailure, networkFailure, timeout]) {
      expect(message).not.toMatch(JARGON);
      expect(message).not.toMatch(/not a word|invalid|not in the dictionary/i);
    }
  });
});

describe('firstDefinition', () => {
  it('prefixes the part of speech', () => {
    expect(firstDefinition(entry('quiz'))).toBe('(noun) meaning of quiz');
  });

  it('falls back when an entry carries no definitions', () => {
    expect(firstDefinition([{ word: 'x', meanings: [] }])).toBe('Found in the dictionary.');
  });
});
