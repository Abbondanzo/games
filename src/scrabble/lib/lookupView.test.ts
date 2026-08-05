import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDictionaryCache, retryConfig } from './dictionary';
import { runLookup } from './lookupView';

const entry = (word: string) => [
  {
    word,
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: `meaning of ${word}` }] }],
  },
];

const originalDelay = retryConfig.delayMs;

beforeEach(() => {
  clearDictionaryCache();
  retryConfig.delayMs = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  retryConfig.delayMs = originalDelay;
});

describe('runLookup', () => {
  it('reports a known word as valid, with its first definition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => entry('quiz') })),
    );
    await expect(runLookup('quiz')).resolves.toMatchObject({
      kind: 'valid',
      word: 'QUIZ',
      detail: '(noun) meaning of quiz',
    });
  });

  it('reports a 404 as invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(runLookup('zzzz')).resolves.toMatchObject({ kind: 'invalid', word: 'ZZZZ' });
  });

  // Proper nouns 404 like any other absent word, which is right for Scrabble.
  it('reports a proper noun as invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(runLookup('London')).resolves.toMatchObject({ kind: 'invalid', word: 'LONDON' });
  });

  it('separates a service failure from an invalid word', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502 })),
    );
    const view = await runLookup('ax');
    expect(view.kind).toBe('error');
    expect(view.kind === 'error' && view.message).toMatch(/perfectly valid word/);
  });
});
