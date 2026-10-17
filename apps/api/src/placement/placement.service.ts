import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CEFR } from '../auth/auth.schemas';
import { AppError } from '../common/app-error';
import { DB, DrizzleDB } from '../database/database.module';
import { PlacementAttempt, placementAttempts, placementPrompts } from '../database/schema';
import { LlmClient } from '../llm/llm.client';

type Level = (typeof CEFR)[number];

const ATTEMPT_TTL_MS = 60 * 60 * 1000;
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', de: 'German', fr: 'French', es: 'Spanish', tr: 'Turkish', ar: 'Arabic',
};

/** What the model must return. Anything else counts as a scoring failure. */
const ScoreSchema = z.object({
  level: z.enum(CEFR),
  reason: z.string().min(1).max(400),
  strengths: z.array(z.string().max(40)).max(3).default([]),
  focusAreas: z.array(z.string().max(40)).max(3).default([]),
});

export interface PlacementResultDto {
  assessmentId: string;
  suggestedLevel: Level;
  selfRatedLevel: Level | null;
  scored: boolean;
  reason: string | null;
  strengths: string[];
  focusAreas: string[];
}

@Injectable()
export class PlacementService {
  private readonly logger = new Logger('Placement');

  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly llm: LlmClient,
  ) {}

  /** Picks a random active prompt for the language pair and level and opens an attempt. */
  async createAttempt(spokenLanguage: string, targetLanguage: string, selfRatedLevel: Level | null) {
    const level = selfRatedLevel ?? 'A1';
    const [prompt] = await this.db
      .select()
      .from(placementPrompts)
      .where(
        and(
          eq(placementPrompts.spokenLanguage, spokenLanguage),
          eq(placementPrompts.targetLanguage, targetLanguage),
          eq(placementPrompts.level, level),
          eq(placementPrompts.active, true),
        ),
      )
      .orderBy(sql`random()`)
      .limit(1);
    if (!prompt) throw new AppError('NOT_FOUND', 'No placement prompt is available for this language yet.');

    const [attempt] = await this.db
      .insert(placementAttempts)
      .values({
        promptId: prompt.id,
        spokenLanguage,
        targetLanguage,
        selfRatedLevel,
        expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
      })
      .returning();
    return {
      attempt: {
        id: attempt.id,
        prompt: { text: prompt.text, language: spokenLanguage },
        expiresAt: attempt.expiresAt.toISOString(),
      },
    };
  }

  /**
   * Scores the transcript once. Skips, LLM failures and invalid model output fall back to the
   * self-rating with `scored: false`, so onboarding never blocks on scoring (contract D20).
   */
  async submit(attemptId: string, transcript: string, skipped: boolean): Promise<PlacementResultDto> {
    const [attempt] = await this.db.select().from(placementAttempts).where(eq(placementAttempts.id, attemptId));
    if (!attempt) throw new AppError('NOT_FOUND', 'This placement attempt does not exist.');
    if (attempt.submittedAt) return toResult(attempt);
    if (attempt.expiresAt.getTime() < Date.now()) throw new AppError('NOT_FOUND', 'This placement attempt has expired.');

    const fallback = attempt.selfRatedLevel ?? 'A1';
    let update: Partial<PlacementAttempt> = { transcript: skipped ? null : transcript, skipped, suggestedLevel: fallback, scored: false };

    if (!skipped) {
      const [prompt] = await this.db.select().from(placementPrompts).where(eq(placementPrompts.id, attempt.promptId));
      try {
        const score = await this.score(prompt.text, prompt.level, transcript, attempt);
        update = { ...update, ...score };
      } catch (error) {
        const detail = [(error as { code?: string })?.code, error instanceof Error ? error.message : String(error)].filter(Boolean).join(' ');
        this.logger.warn(`scoring failed for ${attemptId}, using self-rating: ${detail || 'unknown error'}`);
      }
    }

    const [saved] = await this.db
      .update(placementAttempts)
      .set({ ...update, submittedAt: new Date() })
      .where(eq(placementAttempts.id, attemptId))
      .returning();
    return toResult(saved);
  }

  /** One bounded LLM call. The prompt only tests up to its own level, so the result is capped one level above it. */
  private async score(promptText: string, promptLevel: Level, transcript: string, attempt: PlacementAttempt) {
    const learnerLanguage = LANGUAGE_NAMES[attempt.spokenLanguage] ?? 'English';
    const system = [
      'You are a strict, fair CEFR examiner for German as a foreign language.',
      `The learner was shown a sentence in ${learnerLanguage} and said its German translation aloud.`,
      'The German text is an automatic speech transcript: ignore punctuation, capitalisation and small transcription noise.',
      'Judge meaning, grammar, vocabulary and word order. Do not judge pronunciation.',
      `Write "reason", "strengths" and "focusAreas" in ${learnerLanguage}. Keep "reason" to one or two short sentences;`,
      'strengths and focusAreas are at most 3 labels of 1-3 words each.',
      'Respond with only this JSON object:',
      '{"level":"A1|A2|B1|B2|C1","reason":"...","strengths":["..."],"focusAreas":["..."]}',
    ].join('\n');
    const prompt = [
      `Sentence shown (${learnerLanguage}, CEFR ${promptLevel}): ${promptText}`,
      `Learner's self-rating: ${attempt.selfRatedLevel ?? 'none'}`,
      `Learner's German (transcript): ${transcript}`,
    ].join('\n');

    const res = await this.llm.generate({ task: 'placement_scoring', system, prompt, maxTokens: 220, temperature: 0, json: true });
    const parsed = ScoreSchema.parse(JSON.parse(extractJson(res.text)));
    return {
      suggestedLevel: capLevel(parsed.level, promptLevel),
      scored: true,
      reason: parsed.reason,
      strengths: parsed.strengths,
      focusAreas: parsed.focusAreas,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
    };
  }
}

function capLevel(level: Level, promptLevel: Level): Level {
  const max = Math.min(CEFR.indexOf(promptLevel) + 1, CEFR.length - 1);
  return CEFR[Math.min(CEFR.indexOf(level), max)];
}

/** Models sometimes wrap JSON in prose or code fences; take the outermost object. */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in model output');
  return text.slice(start, end + 1);
}

function toResult(a: PlacementAttempt): PlacementResultDto {
  return {
    assessmentId: a.id,
    suggestedLevel: (a.suggestedLevel ?? a.selfRatedLevel ?? 'A1') as Level,
    selfRatedLevel: a.selfRatedLevel as Level | null,
    scored: a.scored,
    reason: a.scored ? a.reason : null,
    strengths: a.scored ? (a.strengths ?? []) : [],
    focusAreas: a.scored ? (a.focusAreas ?? []) : [],
  };
}
