import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DB, DrizzleDB } from '../database/database.module';
import { DictionaryEntry, dictionaryAliases, dictionaryEntries } from '../database/schema';
import { LlmClient } from '../llm/llm.client';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', tr: 'Turkish', ar: 'Arabic',
};
const PARTS = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] as const;

/** "die Kaution" → { article: 'die', lemma: 'Kaution' }; tolerant of quotes and extra spaces. */
export function splitLemma(input: string): { article: 'der' | 'die' | 'das' | null; lemma: string } {
  const clean = input.replace(/[„“"'.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(der|die|das)\s+(.+)$/i.exec(clean);
  return m ? { article: m[1].toLowerCase() as 'der' | 'die' | 'das', lemma: m[2] } : { article: null, lemma: clean };
}

const EntrySchema = z.object({
  lemma: z.string().trim().min(1).max(80),
  article: z.preprocess((v) => (typeof v === 'string' && /^(der|die|das)$/i.test(v.trim()) ? v.trim().toLowerCase() : null), z.enum(['der', 'die', 'das']).nullable()),
  plural: z.preprocess((v) => (typeof v === 'string' && v.trim() && !/^(-|none|null|n\/a)$/i.test(v.trim()) ? v.trim().slice(0, 80) : null), z.string().nullable()),
  partOfSpeech: z.preprocess((v) => (typeof v === 'string' && (PARTS as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() : 'other'), z.enum(PARTS)),
  meaning: z.string().trim().min(1).max(200),
  example: z.string().trim().min(1).max(200),
});

/**
 * German dictionary cache shared by all learners. A miss costs one bounded LLM call;
 * after that the entry is a free database read (D10). Entries are keyed by the
 * lowercased lemma and the language of the meaning.
 */
@Injectable()
export class DictionaryService {
  private readonly logger = new Logger('Dictionary');

  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly llm: LlmClient,
  ) {}

  /**
   * Returns the cached entry, or creates it. `input` may be inflected ("Schmerzen", "hatte");
   * the entry is its lemma. `context` (the sentence it came from) only helps on a cache miss.
   * Throws if the word can't be resolved.
   */
  async resolve(input: string, meaningLanguage: string, context?: string): Promise<DictionaryEntry> {
    const { lemma } = splitLemma(input);
    if (!lemma || lemma.length > 80) throw new Error('invalid lemma');
    const key = lemma.toLowerCase();
    const cached = (await this.find(key, meaningLanguage)) ?? (await this.findAlias(key, meaningLanguage));
    if (cached) return cached;

    const language = LANGUAGE_NAMES[meaningLanguage] ?? 'English';
    const system = [
      'You are a precise German dictionary.',
      'Given a German word or short phrase, possibly inflected or conjugated, return its dictionary form:',
      '- "lemma": base form without article (nouns capitalised, verbs in the infinitive).',
      '- "article": der, die or das for nouns, otherwise null.',
      '- "plural": the plural form for nouns, otherwise null.',
      '- "partOfSpeech": noun, verb, adjective, adverb, phrase or other.',
      `- "meaning": a short translation in ${language} (1-4 words).`,
      '- "example": one short, natural German sentence using it (A2 level).',
      'Respond with only one JSON object, for example:',
      '{"lemma":"Bahnhof","article":"der","plural":"Bahnhöfe","partOfSpeech":"noun","meaning":"train station","example":"Der Bahnhof ist nicht weit."}',
    ].join('\n');
    const prompt = context ? `Word: ${input.trim()}\nSentence it appears in: ${context}` : `Word: ${input.trim()}`;
    const res = await this.llm.generate({ task: 'vocabulary', system, prompt, maxTokens: 120, temperature: 0, json: true });
    const start = res.text.indexOf('{');
    const end = res.text.lastIndexOf('}');
    const parsed = EntrySchema.safeParse(start >= 0 && end > start ? safeParse(res.text.slice(start, end + 1)) : null);
    if (!parsed.success) throw new Error(`invalid dictionary output: ${res.text.slice(0, 160)}`);

    // Validated above, so every field is present.
    const entry = parsed.data as Required<z.infer<typeof EntrySchema>>;
    const entryKey = entry.lemma.toLowerCase();
    // The model may normalise the word (e.g. "Kautionen" → "Kaution"); cache under the normalised key.
    const [created] = await this.db
      .insert(dictionaryEntries)
      .values({ lemmaKey: entryKey, meaningLanguage, ...entry })
      .onConflictDoNothing()
      .returning();
    const result = created ?? (await this.find(entryKey, meaningLanguage));
    if (!result) throw new Error('dictionary entry could not be stored');
    if (key !== entryKey) {
      await this.db.insert(dictionaryAliases).values({ surfaceKey: key, meaningLanguage, entryId: result.id }).onConflictDoNothing();
    }
    this.logger.log(`cached "${result.lemma}"${key !== entryKey ? ` (from "${lemma}")` : ''} (${meaningLanguage})`);
    return result;
  }

  private async findAlias(key: string, meaningLanguage: string): Promise<DictionaryEntry | undefined> {
    const [row] = await this.db
      .select({ e: dictionaryEntries })
      .from(dictionaryAliases)
      .innerJoin(dictionaryEntries, eq(dictionaryEntries.id, dictionaryAliases.entryId))
      .where(and(eq(dictionaryAliases.surfaceKey, key), eq(dictionaryAliases.meaningLanguage, meaningLanguage)));
    return row?.e;
  }

  private async find(key: string, meaningLanguage: string): Promise<DictionaryEntry | undefined> {
    const [row] = await this.db
      .select()
      .from(dictionaryEntries)
      .where(and(eq(dictionaryEntries.lemmaKey, key), eq(dictionaryEntries.meaningLanguage, meaningLanguage)));
    return row;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
