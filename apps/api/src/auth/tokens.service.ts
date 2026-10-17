import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../common/app-error';
import { AUTH, env } from '../config/env';
import { DB, DrizzleDB } from '../database/database.module';
import { authSessions } from '../database/schema';

export interface Tokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Short-lived JWT access tokens plus opaque refresh tokens that rotate on every use. */
@Injectable()
export class TokensService {
  constructor(@Inject(DB) private readonly db: DrizzleDB) {}

  private key() {
    return new TextEncoder().encode(env.jwtAccessSecret);
  }

  /** Creates a new session (refresh token) and an access token for it. */
  async issue(userId: string, userAgent?: string): Promise<Tokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpires = new Date(Date.now() + AUTH.refreshTokenTtlSec * 1000);
    await this.db.insert(authSessions).values({
      userId,
      refreshTokenHash: sha256(refreshToken),
      expiresAt: refreshExpires,
      userAgent: userAgent?.slice(0, 300),
    });
    return this.withAccess(userId, refreshToken, refreshExpires);
  }

  /** Exchanges a refresh token for a new pair. Reusing a rotated token revokes all of the user's sessions. */
  async refresh(refreshToken: string, userAgent?: string): Promise<Tokens> {
    const [session] = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.refreshTokenHash, sha256(refreshToken)));
    if (!session) throw new AppError('REFRESH_INVALID', 'Please sign in again.');

    if (session.revokedAt) {
      if (session.replacedById) await this.revokeAll(session.userId);
      throw new AppError('REFRESH_INVALID', 'Please sign in again.');
    }
    if (session.expiresAt.getTime() < Date.now()) throw new AppError('REFRESH_INVALID', 'Please sign in again.');

    const next = randomBytes(32).toString('base64url');
    const nextExpires = new Date(Date.now() + AUTH.refreshTokenTtlSec * 1000);
    await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(authSessions)
        .values({ userId: session.userId, refreshTokenHash: sha256(next), expiresAt: nextExpires, userAgent: userAgent?.slice(0, 300) })
        .returning({ id: authSessions.id });
      await tx
        .update(authSessions)
        .set({ revokedAt: new Date(), replacedById: created.id })
        .where(eq(authSessions.id, session.id));
    });
    return this.withAccess(session.userId, next, nextExpires);
  }

  async revoke(userId: string, refreshToken: string) {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.userId, userId), eq(authSessions.refreshTokenHash, sha256(refreshToken)), isNull(authSessions.revokedAt)));
  }

  async revokeAll(userId: string) {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
  }

  /** Returns the user id from a valid access token, or throws UNAUTHORIZED. */
  async verifyAccess(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key(), { algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string') throw new Error('no subject');
      return payload.sub;
    } catch {
      throw new AppError('UNAUTHORIZED', 'Your session has expired.');
    }
  }

  private async withAccess(userId: string, refreshToken: string, refreshExpires: Date): Promise<Tokens> {
    const accessExpires = new Date(Date.now() + AUTH.accessTokenTtlSec * 1000);
    const accessToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(accessExpires.getTime() / 1000))
      .sign(this.key());
    return {
      accessToken,
      accessTokenExpiresAt: accessExpires.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpires.toISOString(),
    };
  }
}
