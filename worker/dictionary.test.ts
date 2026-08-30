import { describe, expect, it } from 'vitest';
import { normalise } from './dictionary';

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
