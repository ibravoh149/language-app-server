import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { DB, DrizzleDB } from '../database/database.module';
import { DictionaryEntry, dictionaryEntries, userProfiles, userWords } from '../database/schema';
import { DictionaryService } from './dictionary.service';

export interface WordDto {
  id: string;
  lemma: string;
  article: 'der' | 'die' | 'das' | null;
  plural: string | null;
  partOfSpeech: string;
  meaning: string;
  example: string;
  saved: boolean;
  source: 'roleplay' | 'manual';
  createdAt: string | null;
}

/** My Words: the learner's saved vocabulary, backed by the shared dictionary cache. */
@Injectable()
export class WordsService {
  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly dictionary: DictionaryService,
  ) {}

  async spokenLanguage(userId: string): Promise<string> {
    const [p] = await this.db.select({ l: userProfiles.spokenLanguage }).from(userProfiles).where(eq(userProfiles.userId, userId));
    return p?.l ?? 'en';
  }

  async list(userId: string): Promise<WordDto[]> {
    const rows = await this.db
      .select({ w: userWords, e: dictionaryEntries })
      .from(userWords)
      .innerJoin(dictionaryEntries, eq(dictionaryEntries.id, userWords.entryId))
      .where(eq(userWords.userId, userId))
      .orderBy(desc(userWords.createdAt));
    return rows.map(({ w, e }) => toDto(e, w));
  }

  /** The most recently saved lemmas, for the tutor's memory. */
  async recentLemmas(userId: string, limit = 6): Promise<string[]> {
    const rows = await this.db
      .select({ lemma: dictionaryEntries.lemma, article: dictionaryEntries.article })
      .from(userWords)
      .innerJoin(dictionaryEntries, eq(dictionaryEntries.id, userWords.entryId))
      .where(eq(userWords.userId, userId))
      .orderBy(desc(userWords.createdAt))
      .limit(limit);
    return rows.map((r) => (r.article ? `${r.article} ${r.lemma}` : r.lemma));
  }

  /** Resolves a word through the dictionary; throws TUTOR_UNAVAILABLE if it can't be created. */
  async lookup(userId: string, input: string): Promise<DictionaryEntry> {
    try {
      return await this.dictionary.resolve(input, await this.spokenLanguage(userId));
    } catch {
      throw new AppError('TUTOR_UNAVAILABLE', 'That word could not be looked up just now. Please try again.');
    }
  }

  /** Saves a dictionary entry to My Words (idempotent). Returns the word and whether it was newly saved. */
  async save(userId: string, entry: DictionaryEntry, source: 'roleplay' | 'manual', sessionId?: string) {
    const [created] = await this.db
      .insert(userWords)
      .values({ userId, entryId: entry.id, source, sessionId })
      .onConflictDoNothing()
      .returning();
    const row =
      created ??
      (await this.db.select().from(userWords).where(and(eq(userWords.userId, userId), eq(userWords.entryId, entry.id))))[0];
    return { word: toDto(entry, row), created: !!created };
  }

  /** A dictionary entry as the learner sees it, saved or not. */
  async describe(userId: string, entry: DictionaryEntry): Promise<WordDto> {
    const [row] = await this.db.select().from(userWords).where(and(eq(userWords.userId, userId), eq(userWords.entryId, entry.id)));
    return toDto(entry, row);
  }

  async remove(userId: string, id: string) {
    const deleted = await this.db
      .delete(userWords)
      .where(and(eq(userWords.id, id), eq(userWords.userId, userId)))
      .returning({ id: userWords.id });
    if (!deleted.length) throw new AppError('NOT_FOUND', 'This word is not in your list.');
  }
}

function toDto(e: DictionaryEntry, w?: typeof userWords.$inferSelect): WordDto {
  return {
    id: w?.id ?? e.id,
    lemma: e.lemma,
    article: (e.article as WordDto['article']) ?? null,
    plural: e.plural,
    partOfSpeech: e.partOfSpeech,
    meaning: e.meaning,
    example: e.example,
    saved: !!w,
    source: (w?.source as WordDto['source']) ?? 'roleplay',
    createdAt: w ? w.createdAt.toISOString() : null,
  };
}
