import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import { TokensService } from '../auth/tokens.service';
import { AppError } from '../common/app-error';
import { DB, DrizzleDB } from '../database/database.module';
import { authIdentities, users } from '../database/schema';
import { decodeCursor, encodeCursor } from './admin-query';
import { AuditService } from './audit.service';

type Row = Record<string, unknown>;

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  emailVerified: boolean;
  onboarded: boolean;
  suspended: boolean;
  level: string | null;
  streak: number;
  lastActiveAt: string | null;
  roles: string[];
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Admin user management (admin.md → Phase A). Every write is audit-logged. */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  /** One query shape for list and detail. A streak whose last day is before yesterday counts as 0. */
  private rowsQuery(where: ReturnType<typeof sql>, limit: number) {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    return sql`
      select u.id, u.email, u.name, u.created_at, u.email_verified_at, u.onboarding_completed_at,
        u.suspended_at, u.suspended_reason, u.password_hash is not null as has_password,
        p.chosen_level,
        case when s.last_produced_date >= ${yesterday} then coalesce(s.current, 0) else 0 end as streak,
        coalesce(s.longest, 0) as longest,
        (select max(t.created_at) from session_turns t join speaking_sessions ss on ss.id = t.session_id
           where ss.user_id = u.id and t.role = 'user') as last_active_at,
        coalesce((select array_agg(r.key order by r.key) from user_roles ur join roles r on r.id = ur.role_id
           where ur.user_id = u.id), '{}') as roles
      from users u
      left join user_profiles p on p.user_id = u.id
      left join streaks s on s.user_id = u.id
      where ${where}
      order by u.created_at desc, u.id desc
      limit ${limit}`;
  }

  private toRow(r: Row): AdminUserRow {
    return {
      id: String(r.id),
      email: String(r.email),
      name: (r.name as string) ?? null,
      createdAt: iso(r.created_at)!,
      emailVerified: !!r.email_verified_at,
      onboarded: !!r.onboarding_completed_at,
      suspended: !!r.suspended_at,
      level: (r.chosen_level as string) ?? null,
      streak: Number(r.streak ?? 0),
      lastActiveAt: iso(r.last_active_at),
      roles: (r.roles as string[]) ?? [],
    };
  }

  async list(filter: { q?: string; cursor?: string; limit: number }) {
    const cursor = decodeCursor(filter.cursor);
    const conditions = [sql`true`];
    if (filter.q) {
      const like = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(sql`(u.email ilike ${like} or u.name ilike ${like})`);
    }
    if (cursor) {
      conditions.push(sql`(u.created_at, u.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
    }
    const rows = Array.from((await this.db.execute(this.rowsQuery(sql.join(conditions, sql` and `), filter.limit + 1))) as Iterable<Row>);
    const page = rows.slice(0, filter.limit).map((r) => this.toRow(r));
    const last = page.at(-1);
    return { users: page, nextCursor: rows.length > filter.limit && last ? encodeCursor(new Date(last.createdAt), last.id) : null };
  }

  private async requireRow(userId: string): Promise<Row> {
    const [row] = Array.from((await this.db.execute(this.rowsQuery(sql`u.id = ${userId}::uuid`, 1))) as Iterable<Row>);
    if (!row) throw new AppError('NOT_FOUND', 'User not found.');
    return row;
  }

  async row(userId: string): Promise<AdminUserRow> {
    return this.toRow(await this.requireRow(userId));
  }

  async detail(userId: string) {
    const row = await this.requireRow(userId);
    const identities = await this.db.select({ provider: authIdentities.provider }).from(authIdentities).where(eq(authIdentities.userId, userId));
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [stats] = Array.from(
      (await this.db.execute(sql`
        select
          (select count(*) from speaking_sessions where user_id = ${userId}::uuid)::int as sessions,
          (select count(*) from speaking_sessions where user_id = ${userId}::uuid and ended_at is not null)::int as completed,
          (select count(*) from session_turns t join speaking_sessions s on s.id = t.session_id
             where s.user_id = ${userId}::uuid and t.role = 'user')::int as turns,
          (select count(*) from user_words where user_id = ${userId}::uuid)::int as words,
          (select count(*) from corrections where user_id = ${userId}::uuid)::int as corrections,
          (select count(*) from llm_calls where user_id = ${userId}::uuid and created_at >= ${since}::timestamptz)::int as llm_calls,
          (select coalesce(sum(cost_usd), 0) from llm_calls where user_id = ${userId}::uuid and created_at >= ${since}::timestamptz)::float8 as cost`)) as Iterable<Row>,
    );
    const [profile] = Array.from(
      (await this.db.execute(sql`
        select interface_language, spoken_language, target_language, self_rated_level, suggested_level, chosen_level, daily_minutes, voice_id
        from user_profiles where user_id = ${userId}::uuid`)) as Iterable<Row>,
    );
    const sessions = Array.from(
      (await this.db.execute(sql`
        select s.id, sc.title, s.started_at, s.ended_at, s.turn_count
        from speaking_sessions s join scenarios sc on sc.id = s.scenario_id
        where s.user_id = ${userId}::uuid order by s.started_at desc limit 10`)) as Iterable<Row>,
    );

    return {
      user: {
        ...this.toRow(row),
        suspendedAt: iso(row.suspended_at),
        suspendedReason: (row.suspended_reason as string) ?? null,
        signInMethods: [...(row.has_password ? ['password' as const] : []), ...identities.map((i) => i.provider)],
      },
      profile: profile
        ? {
            interfaceLanguage: String(profile.interface_language),
            spokenLanguage: String(profile.spoken_language),
            targetLanguage: String(profile.target_language),
            selfRatedLevel: (profile.self_rated_level as string) ?? null,
            suggestedLevel: (profile.suggested_level as string) ?? null,
            chosenLevel: String(profile.chosen_level),
            dailyMinutes: Number(profile.daily_minutes),
            voiceId: String(profile.voice_id),
          }
        : null,
      stats: {
        sessions: Number(stats.sessions),
        completedSessions: Number(stats.completed),
        turns: Number(stats.turns),
        savedWords: Number(stats.words),
        corrections: Number(stats.corrections),
        longestStreak: Number(row.longest ?? 0),
        llmCalls30d: Number(stats.llm_calls),
        costUsd30d: Number(Number(stats.cost).toFixed(6)),
      },
      recentSessions: sessions.map((s) => ({
        id: String(s.id),
        scenario: String(s.title),
        startedAt: iso(s.started_at)!,
        endedAt: iso(s.ended_at),
        turnCount: Number(s.turn_count),
      })),
    };
  }

  async verifyEmail(actorId: string, userId: string, reason?: string) {
    await this.requireRow(userId);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, userId));
      await this.audit.record({ actorId, action: 'user.verify_email', target: { type: 'user', id: userId }, reason }, tx);
    });
    return this.row(userId);
  }

  async suspend(actorId: string, userId: string, reason: string) {
    this.notSelf(actorId, userId, 'suspend');
    await this.requireRow(userId);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ suspendedAt: new Date(), suspendedReason: reason }).where(eq(users.id, userId));
      await this.audit.record({ actorId, action: 'user.suspend', target: { type: 'user', id: userId }, reason }, tx);
    });
    await this.tokens.revokeAll(userId);
    return this.row(userId);
  }

  async unsuspend(actorId: string, userId: string, reason?: string) {
    await this.requireRow(userId);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ suspendedAt: null, suspendedReason: null }).where(eq(users.id, userId));
      await this.audit.record({ actorId, action: 'user.unsuspend', target: { type: 'user', id: userId }, reason }, tx);
    });
    return this.row(userId);
  }

  async remove(actorId: string, userId: string, reason?: string) {
    this.notSelf(actorId, userId, 'delete');
    const row = await this.requireRow(userId);
    // Audit first (keeps the email for the record), then purge; the entry survives the delete.
    await this.audit.record({ actorId, action: 'user.delete', target: { type: 'user', id: userId }, reason, meta: { email: row.email } });
    await this.auth.purgeAccount(userId);
  }

  private notSelf(actorId: string, userId: string, verb: string) {
    if (actorId === userId) {
      throw new AppError('VALIDATION_FAILED', `You can't ${verb} your own account.`, { fields: { id: `You can't ${verb} your own account.` } });
    }
  }
}
