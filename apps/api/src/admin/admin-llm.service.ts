import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, SQL, sql } from 'drizzle-orm';
import { DB, DrizzleDB } from '../database/database.module';
import { llmCalls } from '../database/schema';
import { decodeCursor, encodeCursor, windowDates, windowStart } from './admin-query';

const round = (v: number, digits = 6) => Number(v.toFixed(digits));

/** LLM usage, cost and reliability for the admin dashboard (admin.md → Phase A). */
@Injectable()
export class AdminLlmService {
  constructor(@Inject(DB) private readonly db: DrizzleDB) {}

  async usage(days: number) {
    const from = windowStart(days).toISOString();
    const byTask = Array.from(
      (await this.db.execute(sql`
        select task, coalesce(provider, 'unknown') as provider,
          count(*)::int as calls,
          (count(*) filter (where outcome <> 'ok'))::int as failures,
          (count(*) filter (where fallback))::int as fallbacks,
          coalesce(percentile_cont(0.5) within group (order by ms), 0)::int as p50,
          coalesce(percentile_cont(0.95) within group (order by ms), 0)::int as p95,
          coalesce(sum(prompt_tokens), 0)::int as prompt_tokens,
          coalesce(sum(completion_tokens), 0)::int as completion_tokens,
          coalesce(sum(cost_usd), 0)::float8 as cost
        from llm_calls where created_at >= ${from}::timestamptz
        group by 1, 2 order by calls desc`)) as Iterable<Record<string, number | string>>,
    ).map((r) => ({
      task: String(r.task),
      provider: String(r.provider),
      calls: Number(r.calls),
      failures: Number(r.failures),
      failureRate: Number(r.calls) ? round(Number(r.failures) / Number(r.calls), 4) : 0,
      fallbacks: Number(r.fallbacks),
      p50Ms: Number(r.p50),
      p95Ms: Number(r.p95),
      promptTokens: Number(r.prompt_tokens),
      completionTokens: Number(r.completion_tokens),
      costUsd: round(Number(r.cost)),
    }));

    const daily = new Map(
      Array.from(
        (await this.db.execute(sql`
          select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as calls,
            (count(*) filter (where outcome <> 'ok'))::int as failures, coalesce(sum(cost_usd), 0)::float8 as cost
          from llm_calls where created_at >= ${from}::timestamptz group by 1`)) as Iterable<{ day: string; calls: number; failures: number; cost: number }>,
      ).map((r) => [r.day, r]),
    );
    const series = windowDates(days).map((date) => {
      const r = daily.get(date);
      return { date, calls: Number(r?.calls ?? 0), failures: Number(r?.failures ?? 0), costUsd: round(Number(r?.cost ?? 0)) };
    });

    const sum = (key: 'calls' | 'failures' | 'fallbacks' | 'promptTokens' | 'completionTokens' | 'costUsd') =>
      byTask.reduce((total, row) => total + row[key], 0);
    return {
      totals: {
        calls: sum('calls'),
        failures: sum('failures'),
        fallbacks: sum('fallbacks'),
        promptTokens: sum('promptTokens'),
        completionTokens: sum('completionTokens'),
        costUsd: round(sum('costUsd')),
      },
      byTask,
      series,
    };
  }

  async calls(filter: { task?: string; outcome?: string; cursor?: string; limit: number }) {
    const cursor = decodeCursor(filter.cursor);
    const where: SQL[] = [];
    if (filter.task) where.push(eq(llmCalls.task, filter.task));
    if (filter.outcome) where.push(eq(llmCalls.outcome, filter.outcome));
    if (cursor) {
      const at = new Date(cursor.at);
      where.push(or(lt(llmCalls.createdAt, at), and(eq(llmCalls.createdAt, at), lt(llmCalls.id, cursor.id)))!);
    }
    const rows = await this.db
      .select()
      .from(llmCalls)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(llmCalls.createdAt), desc(llmCalls.id))
      .limit(filter.limit + 1);
    const page = rows.slice(0, filter.limit);
    const last = page.at(-1);
    return {
      calls: page.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        task: r.task,
        provider: r.provider ?? 'unknown',
        model: r.model,
        outcome: r.outcome as 'ok' | 'invalid' | 'error',
        fallback: r.fallback,
        error: r.error,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        ms: r.ms,
        userId: r.userId,
      })),
      nextCursor: rows.length > filter.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}
