import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppError } from '../common/app-error';
import { env } from '../config/env';
import { DB, DrizzleDB } from '../database/database.module';
import { authIdentities, users } from '../database/schema';
import { UsersService } from '../users/users.service';
import { ProfileInput } from './auth.schemas';
import { AuthResult, AuthService } from './auth.service';
import { TokensService } from './tokens.service';

type Provider = 'google' | 'apple';

interface VerifiedIdentity {
  provider: Provider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

const PROVIDERS = {
  google: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] },
  apple: { jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
} as const;

/** Sign in with Google / Apple: verify the provider's ID token, then find, link or create the account. */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger('OAuth');
  private readonly jwks = new Map<Provider, ReturnType<typeof createRemoteJWKSet>>();

  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
  ) {}

  async signIn(
    provider: Provider,
    idToken: string,
    extras: { name?: string; profile?: ProfileInput; assessmentId?: string },
    userAgent?: string,
  ): Promise<AuthResult> {
    const identity = await this.verify(provider, idToken);
    const { userId, isNewUser } = await this.findOrCreate(identity, extras.name);

    if (extras.profile && !(await this.users.getProfile(userId))) {
      await this.users.saveProfile(userId, extras.profile, extras.assessmentId);
    }
    return this.auth.result(userId, isNewUser, userAgent);
  }

  private async verify(provider: Provider, idToken: string): Promise<VerifiedIdentity> {
    const audience = provider === 'google' ? env.googleClientIds : [env.appleBundleId];
    if (!audience.length) {
      throw new AppError('OAUTH_TOKEN_INVALID', `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured on the server.`);
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keySet(provider), {
        issuer: [...PROVIDERS[provider].issuers],
        audience,
      }));
    } catch (error) {
      this.logger.warn(`${provider} token rejected: ${error instanceof Error ? error.message : error}`);
      throw new AppError('OAUTH_TOKEN_INVALID', 'Sign-in could not be verified. Please try again.');
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw new AppError('OAUTH_TOKEN_INVALID', 'Sign-in could not be verified.');

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null;
    // Apple sends email_verified as "true" (string) or true.
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    const name = typeof payload.name === 'string' ? payload.name : null;
    return { provider, subject: payload.sub, email, emailVerified, name };
  }

  /** Remote JWKS are cached by jose. OAUTH_TEST_JWKS_URL lets local tests use their own keys (ignored in production). */
  private keySet(provider: Provider) {
    if (!this.jwks.has(provider)) {
      const override = !env.isProduction ? process.env.OAUTH_TEST_JWKS_URL : undefined;
      this.jwks.set(provider, createRemoteJWKSet(new URL(override || PROVIDERS[provider].jwks)));
    }
    return this.jwks.get(provider)!;
  }

  private async findOrCreate(identity: VerifiedIdentity, nameHint?: string): Promise<{ userId: string; isNewUser: boolean }> {
    const [linked] = await this.db
      .select({ userId: authIdentities.userId })
      .from(authIdentities)
      .where(and(eq(authIdentities.provider, identity.provider), eq(authIdentities.providerUserId, identity.subject)));
    if (linked) return { userId: linked.userId, isNewUser: false };

    if (!identity.email || !identity.emailVerified) {
      throw new AppError('OAUTH_TOKEN_INVALID', 'Your account did not share a verified email address.');
    }

    const existing = await this.users.findByEmail(identity.email);
    if (existing) {
      await this.db.transaction(async (tx) => {
        await tx.insert(authIdentities).values({
          userId: existing.id,
          provider: identity.provider,
          providerUserId: identity.subject,
          email: identity.email,
        });
        if (!existing.emailVerifiedAt) {
          // The provider proved ownership of this email; an unverified password set by
          // someone else must not keep working, so it's removed along with its sessions.
          await tx
            .update(users)
            .set({ emailVerifiedAt: new Date(), passwordHash: null, updatedAt: new Date() })
            .where(eq(users.id, existing.id));
        }
      });
      if (!existing.emailVerifiedAt) await this.tokens.revokeAll(existing.id);
      return { userId: existing.id, isNewUser: false };
    }

    const userId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: identity.email!, name: nameHint || identity.name, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      await tx.insert(authIdentities).values({
        userId: created.id,
        provider: identity.provider,
        providerUserId: identity.subject,
        email: identity.email,
      });
      return created.id;
    });
    return { userId, isNewUser: true };
  }
}
