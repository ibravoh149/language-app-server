import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, SQL } from 'drizzle-orm';
import { DB, DrizzleDB } from '../database/database.module';
import { auditLog, users } from '../database/schema';
import { decodeCursor, encodeCursor } from './admin-query';

type Executor = DrizzleDB | Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

export interface AuditEntry {
  actorId: string;
  action: string;
  target?: { type: string; id: string };
  reason?: string | null;
  meta?: Record<string, unknown>;
}

/** Writes and reads the admin audit log. Every admin write goes through record(). */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: DrizzleDB) {}

  async record(entry: AuditEntry, db: Executor = this.db) {
    const [actor] = await db.select({ email: users.email }).from(users).where(eq(users.id, entry.actorId));
    await db.insert(auditLog).values({
      actorId: entry.actorId,
      actorEmail: actor?.email ?? 'unknown',
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      reason: entry.reason ?? null,
      meta: entry.meta ?? null,
    });
  }

  async list(filter: { actorId?: string; action?: string; cursor?: string; limit: number }) {
    const cursor = decodeCursor(filter.cursor);
    const where: SQL[] = [];
    if (filter.actorId) where.push(eq(auditLog.actorId, filter.actorId));
    if (filter.action) where.push(eq(auditLog.action, filter.action));
    if (cursor) {
      const at = new Date(cursor.at);
      where.push(or(lt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), lt(auditLog.id, cursor.id)))!);
    }
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(filter.limit + 1);
    const page = rows.slice(0, filter.limit);
    const last = page.at(-1);
    return {
      entries: page.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        actor: { id: r.actorId, email: r.actorEmail },
        action: r.action,
        target: r.targetType && r.targetId ? { type: r.targetType, id: r.targetId } : null,
        reason: r.reason,
        meta: r.meta,
      })),
      nextCursor: rows.length > filter.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
}
