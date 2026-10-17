import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { ProfileInput, ProfileSchema } from '../auth/auth.schemas';
import { AppError } from '../common/app-error';
import { validate } from '../common/validate';
import { DB, DrizzleDB } from '../database/database.module';
import { authIdentities, placementAttempts, User, userProfiles, UserProfile, users } from '../database/schema';

type Tx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];
type Executor = DrizzleDB | Tx;

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  authProviders: ('password' | 'apple' | 'google')[];
  onboardingCompleted: boolean;
  createdAt: string;
}

export type ProfileDto = ProfileInput;

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
    return user;
  }

  async toDto(user: User): Promise<UserDto> {
    const identities = await this.db
      .select({ provider: authIdentities.provider })
      .from(authIdentities)
      .where(eq(authIdentities.userId, user.id));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: !!user.emailVerifiedAt,
      authProviders: [...(user.passwordHash ? (['password'] as const) : []), ...identities.map((i) => i.provider)],
      onboardingCompleted: !!user.onboardingCompletedAt,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async getProfile(userId: string): Promise<ProfileDto | null> {
    const [row] = await this.db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return row ? toProfileDto(row) : null;
  }

  /**
   * Creates or partially updates the profile. The first save must contain every field;
   * it marks onboarding complete. Optionally links a placement attempt.
   */
  async saveProfile(userId: string, patch: Partial<ProfileInput>, assessmentId?: string, db: Executor = this.db) {
    const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    const merged = existing ? { ...toProfileDto(existing), ...patch } : patch;
    // Validated against the full schema, so every field is present.
    const full = validate(ProfileSchema, merged) as Required<ProfileInput>;
    const linked = assessmentId ? await this.linkAssessment(userId, assessmentId, db) : false;

    const values = { ...full, ...(linked && { assessmentId }), updatedAt: new Date() };
    if (existing) {
      await db.update(userProfiles).set(values).where(eq(userProfiles.userId, userId));
    } else {
      await db.insert(userProfiles).values({ userId, ...values });
    }
    await db
      .update(users)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.onboardingCompletedAt)));
  }

  /** Attaches an unclaimed placement attempt to the user. Returns false if it doesn't exist or is someone else's. */
  private async linkAssessment(userId: string, assessmentId: string, db: Executor): Promise<boolean> {
    const updated = await db
      .update(placementAttempts)
      .set({ userId })
      .where(and(eq(placementAttempts.id, assessmentId), isNull(placementAttempts.userId)))
      .returning({ id: placementAttempts.id });
    if (updated.length) return true;
    const [owned] = await db
      .select({ id: placementAttempts.id })
      .from(placementAttempts)
      .where(and(eq(placementAttempts.id, assessmentId), eq(placementAttempts.userId, userId)));
    return !!owned;
  }

  async requireUser(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new AppError('UNAUTHORIZED', 'Your session has expired.');
    return user;
  }
}

function toProfileDto(row: UserProfile): ProfileDto {
  return {
    interfaceLanguage: row.interfaceLanguage as ProfileDto['interfaceLanguage'],
    spokenLanguage: row.spokenLanguage as ProfileDto['spokenLanguage'],
    targetLanguage: 'de',
    selfRatedLevel: row.selfRatedLevel,
    suggestedLevel: row.suggestedLevel,
    chosenLevel: row.chosenLevel,
    dailyMinutes: row.dailyMinutes as ProfileDto['dailyMinutes'],
    reminderEnabled: row.reminderEnabled,
    reminderTime: row.reminderTime,
    voiceId: row.voiceId,
    voiceSpeed: row.voiceSpeed as ProfileDto['voiceSpeed'],
  };
}
