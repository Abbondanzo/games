import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDictionaryCache, retryConfig } from './dictionary';
import { runDefinition, runVerdict } from './lookupView';
import { forgetWordList } from './words';

const entry = (word: string) => [
  {
    word,
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `meaning of ${word}` }] }],
  },
];

const original = { ...retryConfig };

/** A dictionary that accepts the connection and never answers. */
const hangs = (_url: string, init?: { signal?: AbortSignal }) =>
  new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new DOMException('aborted', 'AbortError'));
    if (init?.signal?.aborted) fail();
    else init?.signal?.addEventListener('abort', fail, { once: true });
  });

beforeEach(() => {
  clearDictionaryCache();
  retryConfig.delayMs = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(retryConfig, original);
  forgetWordList();
});

describe('runVerdict', () => {
  it('calls a word in the list valid, with no definition yet', async () => {
    await expect(runVerdict('quiz')).resolves.toEqual({
      kind: 'valid',
      word: 'QUIZ',
      detail: null,
      entries: [],
    });
  });

  it('calls a word that is not in the list invalid', async () => {
    await expect(runVerdict('zzzz')).resolves.toMatchObject({ kind: 'invalid', word: 'ZZZZ' });
  });

  // Proper nouns are absent from the list, which is right for Scrabble.
  it('calls a proper noun invalid', async () => {
    await expect(runVerdict('London')).resolves.toMatchObject({ kind: 'invalid', word: 'LONDON' });
  });

  // Regression: validity used to be whatever the API said, so an upstream that
  // never answered meant no verdict at all. It is decided offline now, and the
  // network is not consulted - a dead dictionary cannot withhold a ruling.
  it('rules on a word without touching the network at all', async () => {
    const fetchMock = vi.fn(hangs);
    vi.stubGlobal('fetch', fetchMock);

    await expect(runVerdict('ax')).resolves.toMatchObject({ kind: 'valid', word: 'AX' });
    await expect(runVerdict('zzzz')).resolves.toMatchObject({ kind: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('runDefinition', () => {
  it('returns the first definition when the dictionary answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => entry('quiz') })),
    );
    await expect(runDefinition('quiz')).resolves.toMatchObject({
      detail: '(noun) meaning of quiz',
    });
  });

  // A definition is a sentence, not a ruling: every way of not getting one is
  // the same absence, and none of them may reach the bar as an alarm.
  it.each([
    ['a word the dictionary does not have', { ok: false, status: 404 }],
    ['a service failure', { ok: false, status: 502 }],
  ])('returns nothing to show for %s', async (_case, response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    await expect(runDefinition('quiz')).resolves.toBeNull();
  });

  it('returns nothing to show when the dictionary never answers', async () => {
    retryConfig.timeoutMs = 5;
    vi.stubGlobal('fetch', vi.fn(hangs));
    await expect(runDefinition('quiz')).resolves.toBeNull();
  });

  it('rejects rather than returning when the caller cancels', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(hangs));

    const pending = runDefinition('quiz', controller.signal);
    controller.abort();

    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});
