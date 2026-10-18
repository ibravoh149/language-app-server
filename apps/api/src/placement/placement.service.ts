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

/**
 * What the model must return: observations about the answer, not a level. The level is
 * decided in code (levelFromRubric) so a small model can't drift or echo the self-rating.
 */
/**
 * Display labels are best effort: models return "", a comma-separated string, null or
 * over-long items. Normalise instead of rejecting, so a cosmetic slip never throws away
 * a valid judgement. Only `meaning` and `majorErrors` (which decide the level) are strict.
 */
const labels = z.preprocess((v) => {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return items
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 3);
}, z.array(z.string()));

export const ScoreSchema = z.object({
  meaning: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['full', 'partial', 'none'])),
  majorErrors: z.coerce.number().int().min(0).max(20),
  minorErrors: z.preprocess((v) => v ?? 0, z.coerce.number().int().min(0).max(20)).catch(0),
  reason: z.preprocess((v) => (typeof v === 'string' ? v.trim().slice(0, 400) : ''), z.string()),
  strengths: labels,
  focusAreas: labels,
});

/**
 * The placement rubric. A prompt tests its own level, so the learner "passes" it (gets that
 * level) only when the meaning came across fully with no major errors; otherwise they start
 * one level lower, or at A1 when the meaning didn't come across.
 */
export function levelFromRubric(promptLevel: Level, meaning: 'full' | 'partial' | 'none', majorErrors: number): Level {
  if (meaning === 'none') return 'A1';
  if (meaning === 'full' && majorErrors === 0) return promptLevel;
  return CEFR[Math.max(0, CEFR.indexOf(promptLevel) - 1)];
}

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
        const score = await this.score(prompt.text, prompt.referenceText, prompt.level, transcript, attempt);
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

  /** One bounded LLM call that reports observations; the level comes from levelFromRubric. The self-rating is not sent, so it can't anchor the model. */
  private async score(promptText: string, referenceText: string | null, promptLevel: Level, transcript: string, attempt: PlacementAttempt) {
    const learnerLanguage = LANGUAGE_NAMES[attempt.spokenLanguage] ?? 'English';
    const system = [
      'You are a strict, fair examiner for German as a foreign language.',
      `The learner was shown a sentence in ${learnerLanguage} and said its German translation aloud.`,
      'The German text is an automatic speech transcript. Ignore punctuation and capitalisation.',
      'Words that are not real German, or that make no sense in context, count as not said.',
      'Compare the transcript with the reference translation (other correct wordings are equally fine) and report:',
      '- "meaning": "full" if everything in the sentence came across, "partial" if only some of it did, "none" if it did not.',
      '- "majorErrors": errors that change or block the meaning: a missing, wrong or misplaced verb (German puts the verb second),',
      '  a wrong or missing key word, or a garbled phrase.',
      '- "minorErrors": slips that do not block the meaning: articles, endings, gender, case.',
      'Do not judge pronunciation. Be strict: do not give credit for parts that are missing.',
      `Write "reason", "strengths" and "focusAreas" in ${learnerLanguage}. "reason" is one or two short sentences naming the`,
      'most important mistake, or saying the answer was correct. strengths and focusAreas: at most 3 labels of 1-3 words each.',
      'Respond with only a JSON object in this shape (example values):',
      '{"meaning":"partial","majorErrors":2,"minorErrors":1,"reason":"The drink order is unclear and the verb is missing.","strengths":["polite request"],"focusAreas":["verbs","vocabulary"]}',
    ].join('\n');
    const prompt = [
      `Sentence shown (${learnerLanguage}): ${promptText}`,
      ...(referenceText ? [`Reference translation: ${referenceText}`] : []),
      `Learner's German (transcript): ${transcript}`,
    ].join('\n');

    // Small models occasionally return malformed output; one retry is cheap and bounded.
    let res = await this.llm.generate({ task: 'placement_scoring', system, prompt, maxTokens: 220, temperature: 0, json: true });
    let parsed = ScoreSchema.safeParse(safeJson(res.text));
    if (!parsed.success) {
      this.logger.warn(`invalid scorer output for ${attempt.id}, retrying once`);
      res = await this.llm.generate({ task: 'placement_scoring', system, prompt, maxTokens: 220, temperature: 0.2, json: true });
      parsed = ScoreSchema.safeParse(safeJson(res.text));
    }
    if (!parsed.success) throw new Error(`invalid scorer output: ${res.text.slice(0, 200)}`);
    const score = parsed.data;
    return {
      suggestedLevel: levelFromRubric(promptLevel, score.meaning, score.majorErrors),
      scored: true,
      reason: score.reason || null,
      strengths: score.strengths,
      focusAreas: score.focusAreas,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
    };
  }
}

/**
 * Parses the outermost JSON object in model output. If the JSON is broken (small models
 * sometimes derail mid-object), salvages the fields by pattern so a judgement that was
 * already complete isn't lost. Returns null when nothing usable is found.
 */
export function safeJson(text: string): unknown {
  try {
    return JSON.parse(extractJson(text));
  } catch {
    const meaning = /"meaning"\s*:\s*"(full|partial|none)"/i.exec(text)?.[1];
    const majorErrors = /"majorErrors"\s*:\s*(\d+)/.exec(text)?.[1];
    if (!meaning || majorErrors === undefined) return null;
    return {
      meaning,
      majorErrors,
      minorErrors: /"minorErrors"\s*:\s*(\d+)/.exec(text)?.[1],
      reason: /"reason"\s*:\s*"([^"]*)"/.exec(text)?.[1],
      strengths: /"strengths"\s*:\s*\[([^\]]*)\]/.exec(text)?.[1]?.replace(/"/g, ''),
      focusAreas: /"focusAreas"\s*:\s*\[([^\]]*)\]/.exec(text)?.[1]?.replace(/"/g, ''),
    };
  }
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
