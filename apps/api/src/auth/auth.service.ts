import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { DB, DrizzleDB } from '../database/database.module';
import { authIdentities, User, users } from '../database/schema';
import { ProfileDto, UserDto, UsersService } from '../users/users.service';
import { LoginSchema, ResetPasswordSchema, SignupSchema } from './auth.schemas';
import { CodesService } from './codes.service';
import { Tokens, TokensService } from './tokens.service';

export interface AuthResult {
  user: UserDto;
  profile: ProfileDto | null;
  tokens: Tokens;
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: DrizzleDB,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly codes: CodesService,
  ) {}

  async signup(input: z.infer<typeof SignupSchema>, userAgent?: string): Promise<AuthResult> {
    if (await this.users.findByEmail(input.email)) {
      throw new AppError('EMAIL_TAKEN', 'An account with this email already exists. Try logging in.', {
        fields: { email: 'already registered' },
      });
    }
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const user = await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash }).returning();
      if (input.profile) await this.users.saveProfile(created.id, input.profile, input.assessmentId, tx);
      return created;
    });

    await this.codes.issue(user.id, user.email, 'verify_email');
    return this.result(user.id, true, userAgent);
  }

  async login(input: z.infer<typeof LoginSchema>, userAgent?: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user) throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    if (!user.passwordHash) {
      const [identity] = await this.db.select().from(authIdentities).where(eq(authIdentities.userId, user.id)).limit(1);
      if (identity) {
        throw new AppError('ACCOUNT_USES_SOCIAL', `This account signs in with ${identity.provider === 'apple' ? 'Apple' : 'Google'}.`);
      }
      throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (!(await argon2.verify(user.passwordHash, input.password))) {
      throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    return this.result(user.id, false, userAgent);
  }

  async verifyEmail(userId: string, code: string): Promise<UserDto> {
    const user = await this.users.requireUser(userId);
    if (!user.emailVerifiedAt) {
      await this.codes.consume(userId, 'verify_email', code);
      await this.db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
    }
    return this.users.toDto(await this.users.requireUser(userId));
  }

  async resendVerification(userId: string): Promise<{ resendAvailableAt: string }> {
    const user = await this.users.requireUser(userId);
    if (!user.emailVerifiedAt) {
      await this.codes.assertCanResend(userId, 'verify_email');
      await this.codes.issue(userId, user.email, 'verify_email');
    }
    return { resendAvailableAt: new Date(Date.now() + 60_000).toISOString() };
  }

  /** Always succeeds from the caller's point of view, to avoid revealing which emails exist. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user?.passwordHash) return;
    try {
      await this.codes.assertCanResend(user.id, 'reset_password');
    } catch {
      return;
    }
    await this.codes.issue(user.id, user.email, 'reset_password');
  }

  async resetPassword(input: z.infer<typeof ResetPasswordSchema>, userAgent?: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user) throw new AppError('CODE_INVALID', 'That code is not valid. Request a new one.');
    await this.codes.consume(user.id, 'reset_password', input.code);
    const passwordHash = await argon2.hash(input.newPassword, { type: argon2.argon2id });
    await this.db
      .update(users)
      // Receiving the code proves the inbox belongs to the user.
      .set({ passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await this.tokens.revokeAll(user.id);
    return this.result(user.id, false, userAgent);
  }

  /** Builds the contract's AuthResult and opens a new session. */
  async result(userId: string, isNewUser: boolean, userAgent?: string): Promise<AuthResult> {
    const user: User = await this.users.requireUser(userId);
    return {
      user: await this.users.toDto(user),
      profile: await this.users.getProfile(userId),
      tokens: await this.tokens.issue(userId, userAgent),
      isNewUser,
    };
  }
}
