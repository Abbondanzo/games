/**
 * What the room server hands back for a definition.
 *
 * Merriam-Webster's own shape is idiosyncratic - pronunciations under `hwi`,
 * a part of speech in `fl`, headwords with asterisks in them - and it is also
 * the shape most likely to change out from under us. It is normalised in the
 * Worker so that exactly one file knows it, and so that the key it needs never
 * has to leave the server. This is what both sides agree on instead.
 */
import { z } from 'zod';

export const DefinitionEntrySchema = z.object({
  word: z.string(),
  /** Already wrapped in slashes, or absent when the entry carries none. */
  phonetic: z.string().optional(),
  meanings: z.array(
    z.object({
      partOfSpeech: z.string(),
      definitions: z.array(z.object({ definition: z.string(), example: z.string().optional() })),
    }),
  ),
});

/**
 * `entries` is empty when the dictionary has nothing for the word. That is a
 * successful answer, not a failure: validity is decided against the offline
 * word list, so an absent definition is only ever a missing sentence.
 */
export const DefinitionResponseSchema = z.object({
  entries: z.array(DefinitionEntrySchema),
});

export type DefinitionEntry = z.infer<typeof DefinitionEntrySchema>;
export type DefinitionResponse = z.infer<typeof DefinitionResponseSchema>;
