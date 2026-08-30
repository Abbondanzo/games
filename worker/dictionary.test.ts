import { afterEach, describe, expect, it, vi } from 'vitest';
import { define, normalise } from './dictionary';

/**
 * Merriam-Webster's shape, as documented. Nothing here can be checked against
 * the live service from a test run, which is exactly why `normalise` is written
 * to survive being wrong about it: an entry it cannot read is skipped, and the
 * worst case is a missing definition rather than a broken lookup.
 */
const quiz = [
  {
    meta: { id: 'quiz:1', uuid: 'a1', stems: ['quiz', 'quizzes'] },
    hwi: { hw: 'quiz', prs: [{ mw: 'ˈkwiz', sound: { audio: 'quiz0001' } }] },
    fl: 'noun',
    shortdef: ['an eccentric person', 'a short oral or written test'],
  },
  {
    meta: { id: 'quiz:2', uuid: 'a2' },
    hwi: { hw: 'quiz' },
    fl: 'verb',
    shortdef: ['to question closely'],
  },
];

describe('normalise', () => {
  it('takes the headword, part of speech and short definitions', () => {
    expect(normalise(quiz, 'quiz')).toEqual([
      {
        word: 'quiz',
        phonetic: '/ˈkwiz/',
        meanings: [
          {
            partOfSpeech: 'noun',
            definitions: [
              { definition: 'an eccentric person' },
              { definition: 'a short oral or written test' },
            ],
          },
        ],
      },
      {
        word: 'quiz',
        meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'to question closely' }] }],
      },
    ]);
  });

  it('strips the syllable breaks out of a headword', () => {
    const entry = [{ hwi: { hw: 'ab*ne*gate' }, fl: 'verb', shortdef: ['to deny'] }];
    expect(normalise(entry, 'abnegate')[0]?.word).toBe('abnegate');
  });

  // The dictionary answers a word it does not have with spelling suggestions -
  // plain strings, not entries. Reading those as definitions would put nonsense
  // on the bar, so they have to fall out.
  it('finds nothing in a list of spelling suggestions', () => {
    expect(normalise(['quiz', 'quit', 'quid'], 'kwiz')).toEqual([]);
  });

  it('finds nothing in an empty answer', () => {
    expect(normalise([], 'zzzz')).toEqual([]);
  });

  // The shape is outside our control and the key can expire, so anything that
  // is not the expected array has to come back empty rather than throw.
  it.each([
    ['a plain string', 'Invalid API key. Not for use with this reference'],
    ['an object', { error: 'nope' }],
    ['null', null],
  ])('finds nothing in %s', (_case, payload) => {
    expect(normalise(payload, 'quiz')).toEqual([]);
  });

  it('skips an entry that carries no definitions at all', () => {
    expect(normalise([{ hwi: { hw: 'quiz' }, fl: 'noun', shortdef: [] }], 'quiz')).toEqual([]);
  });

  // Related headwords come back alongside the word actually asked about.
  it('puts the word that was asked for first', () => {
    const mixed = [
      { hwi: { hw: 'quizzical' }, fl: 'adjective', shortdef: ['mildly teasing'] },
      { hwi: { hw: 'quiz' }, fl: 'noun', shortdef: ['a short test'] },
    ];
    expect(normalise(mixed, 'quiz').map((e) => e.word)).toEqual(['quiz', 'quizzical']);
  });
});

describe('define', () => {
  afterEach(() => vi.unstubAllGlobals());

  const upstream = (body: string, status = 200) => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const entries = JSON.stringify([{ hwi: { hw: 'quiz' }, fl: 'noun', shortdef: ['a short test'] }]);

  // Regression: the reference was hardcoded to `collegiate`, which every key
  // for another Merriam-Webster dictionary is refused by. The account's key
  // decides the reference, so configuration does too.
  it('asks the reference it is configured for', async () => {
    const fetchMock = upstream(entries);
    await define('quiz', 'k', 'sd3');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/references/sd3/json/quiz');
  });

  it('falls back to the default reference rather than building a broken address', async () => {
    const fetchMock = upstream(entries);
    await define('quiz', 'k', undefined);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/references\/[a-z0-9-]+\/json\/quiz/);
  });

  // It goes into a URL path. Our own configuration, but a value with a slash in
  // it would send the key somewhere that is not the dictionary.
  it.each(['../../evil', 'sd3/../..', 'https://evil.test', ''])(
    'refuses %s as a reference',
    async (reference) => {
      const fetchMock = upstream(entries);
      await define('quiz', 'k', reference);
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url.startsWith('https://dictionaryapi.com/api/v3/references/')).toBe(true);
      expect(url).not.toContain('evil');
    },
  );

  // Regression: a key for the wrong reference is refused at HTTP 200 with a
  // plain-text body, and the thrown error said only "did not answer with json",
  // which is indistinguishable from an upstream that is simply broken.
  it('carries the upstream’s complaint into the error it throws', async () => {
    upstream('Invalid API key. Not subscribed for this reference.');
    await expect(define('quiz', 'k', 'collegiate')).rejects.toThrow(/Not subscribed/);
  });

  it('never puts the key in the error it throws, since that error is logged', async () => {
    upstream('Invalid API key. Not subscribed for this reference.');
    const error = await define('quiz', 'sekrit', 'collegiate').catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('sekrit');
  });

  it('reports the status when the dictionary refuses outright', async () => {
    upstream('', 403);
    await expect(define('quiz', 'k', 'sd3')).rejects.toThrow(/403/);
  });
});
