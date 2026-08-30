/**
 * Definitions, from Merriam-Webster's Collegiate dictionary.
 *
 * This is the only place the API key exists. It is a Worker secret rather than
 * anything in the bundle, because a key shipped to a browser is a key given
 * away - the free tier is 1000 lookups a day and it is the account's, not the
 * page's. That is the whole reason the client asks the room server for a
 * definition instead of asking the dictionary itself.
 *
 * It is also the only place that knows Merriam-Webster's response shape. That
 * shape is quirky and outside our control, so everything here is lenient: a
 * field that is missing, renamed or a different type costs at most one
 * definition. Validity is decided offline, so nothing in this file can make a
 * word read as invalid.
 */
import { z } from 'zod';
import type { DefinitionEntry, DefinitionResponse } from '../shared/dictionary';

const API = 'https://dictionaryapi.com/api/v3/references/collegiate/json';

/**
 * Deliberately loose. Merriam-Webster answers a word it does not have with an
 * array of spelling suggestions - plain strings, not objects - so an entry that
 * does not parse is skipped rather than failing the request.
 */
const EntrySchema = z.object({
  meta: z.object({ id: z.string().optional() }).optional(),
  hwi: z
    .object({
      hw: z.string().optional(),
      prs: z.array(z.object({ mw: z.string().optional() })).optional(),
    })
    .optional(),
  fl: z.string().optional(),
  shortdef: z.array(z.string()).optional(),
});

/** Headwords carry asterisks at the syllable breaks: `ab*ne*gate`. */
const headword = (entry: z.infer<typeof EntrySchema>, fallback: string): string => {
  const raw = entry.hwi?.hw ?? entry.meta?.id ?? fallback;
  return raw.replace(/\*/g, '').split(':')[0] ?? fallback;
};

export function normalise(payload: unknown, word: string): DefinitionEntry[] {
  if (!Array.isArray(payload)) return [];

  const entries: DefinitionEntry[] = [];
  for (const item of payload) {
    const parsed = EntrySchema.safeParse(item);
    if (!parsed.success) continue;

    const definitions = (parsed.data.shortdef ?? [])
      .filter((text) => text.trim().length > 0)
      .map((definition) => ({ definition }));
    if (!definitions.length) continue;

    const pronunciation = parsed.data.hwi?.prs?.find((p) => p.mw)?.mw;
    entries.push({
      word: headword(parsed.data, word),
      ...(pronunciation ? { phonetic: `/${pronunciation}/` } : {}),
      meanings: [{ partOfSpeech: parsed.data.fl ?? '', definitions }],
    });
  }

  // The dictionary answers with related headwords too - "quizzed" for "quiz" -
  // so the word actually asked about comes first when it is among them.
  const wanted = word.toLowerCase();
  return entries.sort(
    (a, b) => Number(b.word.toLowerCase() === wanted) - Number(a.word.toLowerCase() === wanted),
  );
}

/**
 * Throws when the dictionary could not be asked or did not answer usefully.
 * Returning no entries is a different thing entirely: it means the dictionary
 * answered and has nothing, which is a fine answer and is cached as one.
 */
export async function define(word: string, key: string): Promise<DefinitionResponse> {
  const response = await fetch(`${API}/${encodeURIComponent(word)}?key=${encodeURIComponent(key)}`);
  if (!response.ok) throw new Error(`dictionary responded ${response.status}`);

  // An invalid key comes back as 200 with a plain-text body rather than JSON,
  // so the parse is the check: anything that is not JSON is not an answer.
  const body: unknown = await response.json().catch(() => null);
  if (body === null) throw new Error('dictionary did not answer with json');

  return { entries: normalise(body, word) };
}
