import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, DrizzleDB } from '../database/database.module';
import { windowDates, windowStart } from './admin-query';

type Row = Record<string, string | number | null>;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
const BUCKETS = ['0', '1-2', '3-6', '7-29', '30+'] as const;

/** Product metrics for the admin overview (admin.md → Phase A). "Active" = sent at least one turn that day. */
@Injectable()
export class AdminOverviewService {
  constructor(@Inject(DB) private readonly db: DrizzleDB) {}

  private async rows(query: ReturnType<typeof sql>): Promise<Row[]> {
    return Array.from((await this.db.execute(query)) as Iterable<Row>);
  }

  async overview(days: number) {
    const from = windowStart(days).toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    const [totals] = await this.rows(sql`
      select
        (select count(*) from users)::int as users,
        (select count(*) from users where email_verified_at is not null)::int as verified,
        (select count(*) from users where onboarding_completed_at is not null)::int as onboarded,
        (select count(*) from speaking_sessions)::int as sessions,
        (select count(*) from speaking_sessions where ended_at is not null)::int as completed,
        (select count(*) from session_turns where role = 'user')::int as turns,
        (select count(*) from user_words)::int as words`);

    const day = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`);
    const daily = new Map<string, { signups: number; activeUsers: number; turns: number; completedSessions: number }>();
    const bump = (rows: Row[], key: 'signups' | 'activeUsers' | 'turns' | 'completedSessions') => {
      for (const r of rows) {
        const entry = daily.get(String(r.day)) ?? { signups: 0, activeUsers: 0, turns: 0, completedSessions: 0 };
        entry[key] = Number(r.n);
        daily.set(String(r.day), entry);
      }
    };
    bump(await this.rows(sql`select ${day('created_at')} as day, count(*)::int as n from users where created_at >= ${from}::timestamptz group by 1`), 'signups');
    bump(
      await this.rows(sql`
        select ${day('t.created_at')} as day, count(distinct s.user_id)::int as n
        from session_turns t join speaking_sessions s on s.id = t.session_id
        where t.role = 'user' and t.created_at >= ${from}::timestamptz group by 1`),
      'activeUsers',
    );
    bump(await this.rows(sql`select ${day('created_at')} as day, count(*)::int as n from session_turns where role = 'user' and created_at >= ${from}::timestamptz group by 1`), 'turns');
    bump(await this.rows(sql`select ${day('ended_at')} as day, count(*)::int as n from speaking_sessions where ended_at >= ${from}::timestamptz group by 1`), 'completedSessions');
    const series = windowDates(days).map((date) => ({ date, ...(daily.get(date) ?? { signups: 0, activeUsers: 0, turns: 0, completedSessions: 0 }) }));
    const todayRow = series.at(-1)!;

    const levelCounts = new Map(
      (await this.rows(sql`select chosen_level as level, count(*)::int as n from user_profiles group by 1`)).map((r) => [String(r.level), Number(r.n)]),
    );
    // A streak only counts if the learner produced today or yesterday; otherwise it's already broken.
    const bucketCounts = new Map(
      (
        await this.rows(sql`
          select case
              when s.last_produced_date >= ${yesterday} and s.current >= 30 then '30+'
              when s.last_produced_date >= ${yesterday} and s.current >= 7 then '7-29'
              when s.last_produced_date >= ${yesterday} and s.current >= 3 then '3-6'
              when s.last_produced_date >= ${yesterday} and s.current >= 1 then '1-2'
              else '0' end as bucket,
            count(*)::int as n
          from users u left join streaks s on s.user_id = u.id group by 1`)
      ).map((r) => [String(r.bucket), Number(r.n)]),
    );

    return {
      totals: {
        users: Number(totals.users),
        verifiedUsers: Number(totals.verified),
        onboardedUsers: Number(totals.onboarded),
        sessions: Number(totals.sessions),
        completedSessions: Number(totals.completed),
        turns: Number(totals.turns),
        savedWords: Number(totals.words),
      },
      today: {
        signups: todayRow.date === today ? todayRow.signups : 0,
        activeUsers: todayRow.date === today ? todayRow.activeUsers : 0,
        turns: todayRow.date === today ? todayRow.turns : 0,
        completedSessions: todayRow.date === today ? todayRow.completedSessions : 0,
      },
      series,
      levels: LEVELS.map((level) => ({ level, users: levelCounts.get(level) ?? 0 })),
      streaks: BUCKETS.map((bucket) => ({ bucket, users: bucketCounts.get(bucket) ?? 0 })),
    };
  }
}
