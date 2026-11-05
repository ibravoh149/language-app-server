import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { languageName, targetProfile } from '../common/languages';
import { DB, DrizzleDB } from '../database/database.module';
import { DictionaryEntry, dictionaryAliases, dictionaryEntries } from '../database/schema';
import { LlmClient } from '../llm/llm.client';

interface Lang {
  targetLanguage: string;
  meaningLanguage: string;
}

const PARTS = ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] as const;

/** "die Kaution" → { article: 'die', lemma: 'Kaution' } for the target language's articles; tolerant of quotes and extra spaces. */
export function splitLemma(input: string, articles: string[]): { article: string | null; lemma: string } {
  const clean = input.replace(/[„“"'.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const [first, ...rest] = clean.split(' ');
  return rest.length && articles.includes(first.toLowerCase())
    ? { article: first.toLowerCase(), lemma: rest.join(' ') }
    : { article: null, lemma: clean };
}

const entrySchema = (articles: string[]) => z.object({
  lemma: z.string().trim().min(1).max(80),
  article: z.preprocess((v) => (typeof v === 'string' && articles.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null), z.string().nullable()),
  plural: z.preprocess((v) => (typeof v === 'string' && v.trim() && !/^(-|none|null|n\/a)$/i.test(v.trim()) ? v.trim().slice(0, 80) : null), z.string().nullable()),
  partOfSpeech: z.preprocess((v) => (typeof v === 'string' && (PARTS as readonly string[]).includes(v.toLowerCase()) ? v.toLowerCase() : 'other'), z.enum(PARTS)),
  meaning: z.string().trim().min(1).max(200),
  example: z.string().trim().min(1).max(200),
});
type Entry = z.infer<ReturnType<typeof entrySchema>>;

/**
 * Dictionary cache shared by all learners. A miss costs one bounded LLM call; after that
 * the entry is a free database read (D10). Entries are keyed by the lowercased lemma,
 * the word's language and the language of the meaning.
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
  async resolve(input: string, targetLanguage: string, meaningLanguage: string, context?: string): Promise<DictionaryEntry> {
    const target = targetProfile(targetLanguage);
    const { lemma } = splitLemma(input, target.articles);
    if (!lemma || lemma.length > 80) throw new Error('invalid lemma');
    const key = lemma.toLowerCase();
    const lang = { targetLanguage, meaningLanguage };
    const cached = (await this.find(key, lang)) ?? (await this.findAlias(key, lang));
    if (cached) return cached;

    const language = languageName(meaningLanguage);
    const articles = target.articles.length
      ? `- "article": the definite article for nouns (${target.articles.join(', ')}), otherwise null.`
      : '- "article": always null.';
    const system = [
      `You are a precise ${target.name} dictionary.`,
      `Given a ${target.name} word or short phrase, possibly inflected or conjugated, return its dictionary form:`,
      `- "lemma": base form without article (${target.lemmaForm}).`,
      articles,
      '- "plural": the plural form for nouns, otherwise null.',
      '- "partOfSpeech": noun, verb, adjective, adverb, phrase or other.',
      `- "meaning": a short translation in ${language} (1-4 words).`,
      `- "example": one short, natural ${target.name} sentence using it (A2 level).`,
      'Respond with only one JSON object, for example:',
      target.dictionaryExample,
    ].join('\n');
    const prompt = context ? `Word: ${input.trim()}\nSentence it appears in: ${context}` : `Word: ${input.trim()}`;
    const res = await this.llm.generate({ task: 'vocabulary', system, prompt, maxTokens: 120, temperature: 0, json: true });
    const start = res.text.indexOf('{');
    const end = res.text.lastIndexOf('}');
    const parsed = entrySchema(target.articles).safeParse(start >= 0 && end > start ? safeParse(res.text.slice(start, end + 1)) : null);
    if (!parsed.success) {
      await this.llm.markInvalid(res.callId, 'invalid dictionary output');
      throw new Error(`invalid dictionary output: ${res.text.slice(0, 160)}`);
    }

    // Validated above, so every field is present.
    const entry = parsed.data as Required<Entry>;
    const entryKey = entry.lemma.toLowerCase();
    // The model may normalise the word (e.g. "Kautionen" → "Kaution"); cache under the normalised key.
    const [created] = await this.db
      .insert(dictionaryEntries)
      .values({ lemmaKey: entryKey, ...lang, ...entry })
      .onConflictDoNothing()
      .returning();
    const result = created ?? (await this.find(entryKey, lang));
    if (!result) throw new Error('dictionary entry could not be stored');
    if (key !== entryKey) {
      await this.db.insert(dictionaryAliases).values({ surfaceKey: key, ...lang, entryId: result.id }).onConflictDoNothing();
    }
    this.logger.log(`cached "${result.lemma}"${key !== entryKey ? ` (from "${lemma}")` : ''} (${targetLanguage}→${meaningLanguage})`);
    return result;
  }

  private async findAlias(key: string, { targetLanguage, meaningLanguage }: Lang): Promise<DictionaryEntry | undefined> {
    const [row] = await this.db
      .select({ e: dictionaryEntries })
      .from(dictionaryAliases)
      .innerJoin(dictionaryEntries, eq(dictionaryEntries.id, dictionaryAliases.entryId))
      .where(
        and(
          eq(dictionaryAliases.surfaceKey, key),
          eq(dictionaryAliases.targetLanguage, targetLanguage),
          eq(dictionaryAliases.meaningLanguage, meaningLanguage),
        ),
      );
    return row?.e;
  }

  private async find(key: string, { targetLanguage, meaningLanguage }: Lang): Promise<DictionaryEntry | undefined> {
    const [row] = await this.db
      .select()
      .from(dictionaryEntries)
      .where(
        and(
          eq(dictionaryEntries.lemmaKey, key),
          eq(dictionaryEntries.targetLanguage, targetLanguage),
          eq(dictionaryEntries.meaningLanguage, meaningLanguage),
        ),
      );
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
