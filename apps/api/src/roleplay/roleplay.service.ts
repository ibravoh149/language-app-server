import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, isNotNull, max, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { RateLimiter } from '../common/rate-limiter.service';
import { DB, DrizzleDB } from '../database/database.module';
import {
  activityEvents,
  corrections,
  Scenario,
  scenarios,
  sessionTurns,
  SessionTurn,
  speakingSessions,
  SpeakingSession,
  streaks,
  userProfiles,
} from '../database/schema';
import { TutorService } from './tutor.service';

type Tx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

/** Learner turns per user per day (cost control, D10). Multiplied by 5 in development. */
const DAILY_TURN_CAP = 150;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const previousUtcDay = (day: string) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000));

@Injectable()
export class RoleplayService {
  private readonly logger = new Logger('Roleplay');

  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly tutor: TutorService,
    private readonly limiter: RateLimiter,
  ) {}

  // ── Scenarios ────────────────────────────────────────────────────────────

  async listScenarios(userId: string) {
    const rows = await this.db.select().from(scenarios).where(eq(scenarios.active, true));
    const history = await this.db
      .select({ scenarioId: speakingSessions.scenarioId, times: count(), last: max(speakingSessions.startedAt) })
      .from(speakingSessions)
      .where(and(eq(speakingSessions.userId, userId), isNotNull(speakingSessions.endedAt)))
      .groupBy(speakingSessions.scenarioId);
    const byScenario = new Map(history.map((h) => [h.scenarioId, h]));
    const order = ['A1', 'A2', 'B1', 'B2', 'C1'];
    return rows
      .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || a.title.localeCompare(b.title))
      .map((s) => toSummary(s, byScenario.get(s.id)));
  }

  async getScenario(userId: string, idOrSlug: string) {
    const scenario = await this.findScenario(idOrSlug);
    const [h] = await this.db
      .select({ times: count(), last: max(speakingSessions.startedAt) })
      .from(speakingSessions)
      .where(and(eq(speakingSessions.userId, userId), eq(speakingSessions.scenarioId, scenario.id), isNotNull(speakingSessions.endedAt)));
    return toDetail(scenario, h);
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  /** Starts a session with the scenario's scripted opening line: no LLM call. */
  async startSession(userId: string, scenarioIdOrSlug: string) {
    const scenario = await this.findScenario(scenarioIdOrSlug);
    return this.db.transaction(async (tx) => {
      const [session] = await tx.insert(speakingSessions).values({ userId, scenarioId: scenario.id }).returning();
      const [opening] = await tx
        .insert(sessionTurns)
        .values({ sessionId: session.id, role: 'ai', text: scenario.openingLine })
        .returning();
      return { session: toSessionDto(session), opening: toTurnDto(opening) };
    });
  }

  /**
   * One learner turn: a single LLM call, then everything is stored together. If the tutor
   * fails, nothing is stored and the client can safely re-send the same text.
   */
  async takeTurn(userId: string, sessionId: string, text: string, inputMode: 'voice' | 'text') {
    const session = await this.findSession(userId, sessionId);
    if (session.endedAt) throw new AppError('SESSION_ENDED', 'This conversation has ended. Start a new one.');
    this.limiter.hit(`roleplay-turns:${userId}`, DAILY_TURN_CAP, 86_400);

    const [scenario] = await this.db.select().from(scenarios).where(eq(scenarios.id, session.scenarioId));
    const history = await this.db
      .select({ role: sessionTurns.role, text: sessionTurns.text })
      .from(sessionTurns)
      .where(eq(sessionTurns.sessionId, sessionId))
      .orderBy(asc(sessionTurns.createdAt));
    const [profile] = await this.db
      .select({ spokenLanguage: userProfiles.spokenLanguage })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    let result: Awaited<ReturnType<TutorService['respond']>>;
    try {
      result = await this.tutor.respond(scenario, history, text, profile?.spokenLanguage ?? 'en');
    } catch (error) {
      this.logger.warn(`tutor failed for session ${sessionId}: ${error instanceof Error ? error.message : error}`);
      throw new AppError('TUTOR_UNAVAILABLE', 'Your partner could not answer just now. Please try again.');
    }

    return this.db.transaction(async (tx) => {
      const [userTurn] = await tx
        .insert(sessionTurns)
        .values({ sessionId, role: 'user', text, inputMode, understood: result.understood })
        .returning();
      const [reply] = await tx
        .insert(sessionTurns)
        .values({
          sessionId,
          role: 'ai',
          text: result.reply,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        })
        .returning();
      const saved = result.corrections.length
        ? await tx
            .insert(corrections)
            .values(result.corrections.map((c) => ({ ...c, userId, sessionId, turnId: userTurn.id })))
            .returning()
        : [];
      await tx
        .update(speakingSessions)
        .set({
          turnCount: sql`${speakingSessions.turnCount} + 1`,
          understoodCount: sql`${speakingSessions.understoodCount} + ${result.understood ? 1 : 0}`,
        })
        .where(eq(speakingSessions.id, sessionId));

      let extendedToday = false;
      if (result.understood) {
        await tx.insert(activityEvents).values({ userId, type: 'spoke', refType: 'session_turn', refId: userTurn.id });
        extendedToday = await this.recordProduction(tx, userId);
      }
      const streak = await this.readStreak(tx, userId);

      return {
        userTurn: toTurnDto(userTurn),
        reply: toTurnDto(reply),
        understood: result.understood,
        corrections: saved.map(toCorrectionDto),
        streak: { ...streak, extendedToday },
      };
    });
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.findSession(userId, sessionId);
    const [scenario] = await this.db.select().from(scenarios).where(eq(scenarios.id, session.scenarioId));
    const turns = await this.db
      .select()
      .from(sessionTurns)
      .where(eq(sessionTurns.sessionId, sessionId))
      .orderBy(asc(sessionTurns.createdAt));
    return {
      session: toSessionDto(session),
      scenario: toSummary(scenario),
      turns: turns.map(toTurnDto),
      corrections: await this.sessionCorrections(sessionId),
    };
  }

  async getCorrections(userId: string, sessionId: string) {
    await this.findSession(userId, sessionId);
    return { corrections: await this.sessionCorrections(sessionId) };
  }

  /** Ends the session (idempotent) and returns a summary. */
  async endSession(userId: string, sessionId: string) {
    let session = await this.findSession(userId, sessionId);
    if (!session.endedAt) {
      [session] = await this.db
        .update(speakingSessions)
        .set({ endedAt: new Date() })
        .where(eq(speakingSessions.id, sessionId))
        .returning();
    }
    const [{ total }] = await this.db.select({ total: count() }).from(corrections).where(eq(corrections.sessionId, sessionId));
    return {
      session: { id: session.id, endedAt: session.endedAt!.toISOString() },
      summary: {
        turnCount: session.turnCount,
        understoodCount: session.understoodCount,
        correctionCount: Number(total),
        durationSec: Math.round((session.endedAt!.getTime() - session.startedAt.getTime()) / 1000),
      },
    };
  }

  async getProgress(userId: string) {
    const streak = await this.readStreak(this.db, userId);
    const todayStart = new Date(`${utcDay()}T00:00:00Z`);
    const [{ spoken }] = await this.db
      .select({ spoken: count() })
      .from(activityEvents)
      .where(and(eq(activityEvents.userId, userId), eq(activityEvents.type, 'spoke'), gte(activityEvents.occurredAt, todayStart)));
    const [{ done }] = await this.db
      .select({ done: count() })
      .from(speakingSessions)
      .where(and(eq(speakingSessions.userId, userId), isNotNull(speakingSessions.endedAt)));
    return { streak: { ...streak, extendedToday: false }, spokenTurnsToday: Number(spoken), sessionsCompleted: Number(done) };
  }

  // ── Streak ───────────────────────────────────────────────────────────────

  /** Marks today (UTC) as a production day. Returns true if this call moved the streak. */
  private async recordProduction(tx: Tx, userId: string): Promise<boolean> {
    const today = utcDay();
    const [row] = await tx.select().from(streaks).where(eq(streaks.userId, userId)).for('update');
    if (row?.lastProducedDate === today) return false;
    const current = row?.lastProducedDate === previousUtcDay(today) ? row.current + 1 : 1;
    const longest = Math.max(current, row?.longest ?? 0);
    await tx
      .insert(streaks)
      .values({ userId, current, longest, lastProducedDate: today })
      .onConflictDoUpdate({ target: streaks.userId, set: { current, longest, lastProducedDate: today, updatedAt: new Date() } });
    return true;
  }

  /** Current streak; it reads as 0 once a full UTC day has passed without production. */
  private async readStreak(db: DrizzleDB | Tx, userId: string) {
    const [row] = await db.select().from(streaks).where(eq(streaks.userId, userId));
    const today = utcDay();
    const alive = row?.lastProducedDate === today || row?.lastProducedDate === previousUtcDay(today);
    return {
      current: alive ? row!.current : 0,
      longest: row?.longest ?? 0,
      producedToday: row?.lastProducedDate === today,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findScenario(idOrSlug: string): Promise<Scenario> {
    const [scenario] = await this.db
      .select()
      .from(scenarios)
      .where(and(UUID.test(idOrSlug) ? eq(scenarios.id, idOrSlug) : eq(scenarios.slug, idOrSlug), eq(scenarios.active, true)));
    if (!scenario) throw new AppError('NOT_FOUND', 'This scenario does not exist.');
    return scenario;
  }

  /** Someone else's session reads as not found. */
  private async findSession(userId: string, sessionId: string): Promise<SpeakingSession> {
    if (!UUID.test(sessionId)) throw new AppError('NOT_FOUND', 'This conversation does not exist.');
    const [session] = await this.db
      .select()
      .from(speakingSessions)
      .where(and(eq(speakingSessions.id, sessionId), eq(speakingSessions.userId, userId)));
    if (!session) throw new AppError('NOT_FOUND', 'This conversation does not exist.');
    return session;
  }

  private async sessionCorrections(sessionId: string) {
    const rows = await this.db.select().from(corrections).where(eq(corrections.sessionId, sessionId)).orderBy(asc(corrections.createdAt));
    return rows.map(toCorrectionDto);
  }
}

// ── DTOs (shapes from docs/api/roleplay.md) ─────────────────────────────────

function toSummary(s: Scenario, history?: { times: number; last: Date | null }) {
  return {
    id: s.id,
    slug: s.slug,
    title: s.title,
    subtitle: s.subtitle,
    emoji: s.emoji,
    level: s.level,
    estimatedMinutes: s.estimatedMinutes,
    wordCount: s.words.length,
    timesPracticed: Number(history?.times ?? 0),
    lastPracticedAt: history?.last ? new Date(history.last).toISOString() : null,
  };
}

function toDetail(s: Scenario, history?: { times: number; last: Date | null }) {
  return {
    ...toSummary(s, history),
    situation: s.situation,
    youAre: s.youAre,
    aiIs: s.aiIs,
    goals: s.goals,
    words: s.words,
    phrases: s.phrases,
    grammar: s.grammar,
  };
}

function toSessionDto(s: SpeakingSession) {
  return {
    id: s.id,
    scenarioId: s.scenarioId,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}

function toTurnDto(t: SessionTurn) {
  return { id: t.id, role: t.role, text: t.text, createdAt: t.createdAt.toISOString() };
}

function toCorrectionDto(c: typeof corrections.$inferSelect) {
  return {
    id: c.id,
    turnId: c.turnId,
    original: c.original,
    corrected: c.corrected,
    ruleKey: c.ruleKey,
    ruleName: c.ruleName,
    explanation: c.explanation,
  };
}
