import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DictionaryError,
  clearDictionaryCache,
  firstDefinition,
  lookup,
  retryConfig,
} from './dictionary';

const entry = (word: string) => [
  {
    word,
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `meaning of ${word}` }] }],
  },
];

const okResponse = (word: string) => ({ ok: true, status: 200, json: async () => entry(word) });
const bad = (status: number) => ({ ok: false, status });

/**
 * The upstream's worst failure: the connection is accepted and no response ever
 * comes. Like a real fetch, this settles only when its signal is aborted.
 */
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
  it('returns entries for a known word', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okResponse('quiz')),
    );
    const result = await lookup('QUIZ');
    expect(result).toMatchObject({ status: 'found', word: 'quiz' });
  });

  it('treats a 404 as a miss rather than an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
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

  it('calls the API directly first', async () => {
    const fetchMock = vi.fn(async () => okResponse('cat'));
    vi.stubGlobal('fetch', fetchMock);
    await lookup('cat');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.dictionaryapi.dev/api/v2/entries/en/cat',
      expect.anything(),
    );
  });

  it('retries through the CORS proxy when the direct call is blocked', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse('cat'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookup('cat')).resolves.toMatchObject({ status: 'found' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cors.abbondanzo.workers.dev');
  });

  it('does not retry a 404 through the proxy - the word is simply not there', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(lookup('zzzz')).resolves.toMatchObject({ status: 'missing' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // Regression: nothing bounded a single attempt, so an upstream that accepted
  // the connection and never answered left the bar spinning until the tab was
  // closed. A request that does not answer is retryable, never a verdict.
  it('gives up on a request that is accepted and then never answered', async () => {
    retryConfig.timeoutMs = 5;
    const fetchMock = vi.fn(hangs);
    vi.stubGlobal('fetch', fetchMock);

    const error = await lookup('ax').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DictionaryError);
    expect((error as Error).message).toMatch(/taking too long/);
    expect(fetchMock).toHaveBeenCalledTimes(6); // 3 rounds x 2 endpoints
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
    // 3 rounds × 2 endpoints.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

// The upstream throws sporadic 502s unrelated to the word: "ax" and "za" both
// 502'd once and then resolved on retry. A 5xx must never read as "not a word".
describe('flaky upstream (502)', () => {
  it('retries a 502 and returns the word as valid when it recovers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bad(502))
      .mockResolvedValueOnce(bad(502))
      .mockResolvedValueOnce(okResponse('ax'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookup('ax')).resolves.toMatchObject({ status: 'found' });
  });

  it('retries a 502 and reports a genuine miss when the retry 404s', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bad(502)).mockResolvedValueOnce(bad(404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(lookup('flooble')).resolves.toMatchObject({ status: 'missing' });
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
    const fetchMock = vi.fn(async () => bad(502));
    vi.stubGlobal('fetch', fetchMock);
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
    expect(firstDefinition([{ word: 'x' }])).toBe('Found in the dictionary.');
  });
});
