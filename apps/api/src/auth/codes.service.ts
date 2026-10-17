import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { AppError } from '../common/app-error';
import { AUTH, env } from '../config/env';
import { DB, DrizzleDB } from '../database/database.module';
import { emailCodes } from '../database/schema';
import { CodePurpose, EmailService } from '../email/email.service';

/** 6-digit email codes for verification and password reset. Only an HMAC is stored. */
@Injectable()
export class CodesService {
  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly email: EmailService,
  ) {}

  private hash(userId: string, purpose: CodePurpose, code: string) {
    return createHmac('sha256', env.codeHmacSecret).update(`${userId}:${purpose}:${code}`).digest('hex');
  }

  /** Invalidates earlier codes for this purpose, creates a new one, and emails it. */
  async issue(userId: string, email: string, purpose: CodePurpose) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.transaction(async (tx) => {
      await tx
        .update(emailCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose), isNull(emailCodes.consumedAt)));
      await tx.insert(emailCodes).values({
        userId,
        purpose,
        codeHash: this.hash(userId, purpose, code),
        expiresAt: new Date(Date.now() + AUTH.codeTtlSec * 1000),
      });
    });
    await this.email.sendCode(email, purpose, code);
  }

  /** Enforces the resend cooldown and hourly cap; returns when the next resend is allowed. */
  async assertCanResend(userId: string, purpose: CodePurpose): Promise<void> {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.db
      .select({ createdAt: emailCodes.createdAt })
      .from(emailCodes)
      .where(and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose), gt(emailCodes.createdAt, hourAgo)))
      .orderBy(desc(emailCodes.createdAt));
    if (recent.length) {
      const nextAllowed = recent[0].createdAt.getTime() + AUTH.resendCooldownSec * 1000;
      if (nextAllowed > Date.now()) {
        throw new AppError('RATE_LIMITED', 'Please wait before requesting another code.', {
          retryAfterSec: Math.ceil((nextAllowed - Date.now()) / 1000),
        });
      }
    }
    if (recent.length >= AUTH.resendPerHour) {
      throw new AppError('RATE_LIMITED', 'Too many codes requested. Try again later.', { retryAfterSec: 3600 });
    }
  }

  /** Checks a code and marks it used. Throws CODE_INVALID / CODE_EXPIRED / RATE_LIMITED. */
  async consume(userId: string, purpose: CodePurpose, code: string) {
    const [row] = await this.db
      .select()
      .from(emailCodes)
      .where(and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose), isNull(emailCodes.consumedAt)))
      .orderBy(desc(emailCodes.createdAt))
      .limit(1);
    if (!row) throw new AppError('CODE_INVALID', 'That code is not valid. Request a new one.');
    if (row.expiresAt.getTime() < Date.now()) throw new AppError('CODE_EXPIRED', 'That code has expired. Request a new one.');
    if (row.attempts >= AUTH.codeMaxAttempts) {
      throw new AppError('RATE_LIMITED', 'Too many wrong attempts. Request a new code.', { retryAfterSec: AUTH.resendCooldownSec });
    }

    const expected = Buffer.from(row.codeHash, 'hex');
    const actual = Buffer.from(this.hash(userId, purpose, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.db.update(emailCodes).set({ attempts: row.attempts + 1 }).where(eq(emailCodes.id, row.id));
      throw new AppError('CODE_INVALID', 'That code is not right. Check it and try again.');
    }
    await this.db.update(emailCodes).set({ consumedAt: new Date() }).where(eq(emailCodes.id, row.id));
  }
}
