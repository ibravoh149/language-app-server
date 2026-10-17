import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
};

export const cefrLevel = pgEnum('cefr_level', ['A1', 'A2', 'B1', 'B2', 'C1']);
export const authProvider = pgEnum('auth_provider', ['apple', 'google']);
export const emailCodePurpose = pgEnum('email_code_purpose', ['verify_email', 'reset_password']);

// ── Identity ──────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lowercased and trimmed. */
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: text('name'),
  /** Null for accounts created only through Apple/Google. */
  passwordHash: text('password_hash'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  ...timestamps,
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Apple / Google identities linked to a user. */
export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: authProvider('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    email: varchar('email', { length: 255 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('auth_identities_provider_user_idx').on(t.provider, t.providerUserId),
    index('auth_identities_user_idx').on(t.userId),
  ],
);

/** One row per refresh token. Rotated on every refresh; only the hash is stored. */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Set when this token was rotated; reuse of a rotated token revokes the whole family. */
    replacedById: uuid('replaced_by_id'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => [
    index('auth_sessions_user_idx').on(t.userId),
  ],
);

/** 6-digit codes for email verification and password reset. Only an HMAC of the code is stored. */
export const emailCodes = pgTable(
  'email_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailCodePurpose('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('email_codes_user_purpose_idx').on(t.userId, t.purpose),
  ],
);

// ── Placement ─────────────────────────────────────────────────────────────

/** Prompt bank: sentences in the learner's language to say in German. */
export const placementPrompts = pgTable(
  'placement_prompts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spokenLanguage: varchar('spoken_language', { length: 5 }).notNull(),
    targetLanguage: varchar('target_language', { length: 5 }).notNull(),
    level: cefrLevel('level').notNull(),
    text: text('text').notNull(),
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (t) => [
    index('placement_prompts_lookup_idx').on(t.spokenLanguage, t.targetLanguage, t.level),
  ],
);

/** One placement attempt; its id doubles as the assessmentId linked at signup. */
export const placementAttempts = pgTable('placement_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  promptId: uuid('prompt_id').notNull().references(() => placementPrompts.id),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  spokenLanguage: varchar('spoken_language', { length: 5 }).notNull(),
  targetLanguage: varchar('target_language', { length: 5 }).notNull(),
  selfRatedLevel: cefrLevel('self_rated_level'),
  transcript: text('transcript'),
  skipped: boolean('skipped').default(false).notNull(),
  suggestedLevel: cefrLevel('suggested_level'),
  scored: boolean('scored').default(false).notNull(),
  reason: text('reason'),
  strengths: jsonb('strengths').$type<string[]>(),
  focusAreas: jsonb('focus_areas').$type<string[]>(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  ...timestamps,
});

// ── Profile ───────────────────────────────────────────────────────────────

/** Everything collected during onboarding, one row per user. */
export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  interfaceLanguage: varchar('interface_language', { length: 5 }).notNull(),
  spokenLanguage: varchar('spoken_language', { length: 5 }).notNull(),
  targetLanguage: varchar('target_language', { length: 5 }).notNull(),
  selfRatedLevel: cefrLevel('self_rated_level'),
  suggestedLevel: cefrLevel('suggested_level'),
  chosenLevel: cefrLevel('chosen_level').notNull(),
  dailyMinutes: integer('daily_minutes').notNull(),
  reminderEnabled: boolean('reminder_enabled').notNull(),
  /** "HH:MM" local wall-clock time. */
  reminderTime: varchar('reminder_time', { length: 5 }).notNull(),
  voiceId: text('voice_id').notNull(),
  voiceSpeed: real('voice_speed').notNull(),
  assessmentId: uuid('assessment_id').references(() => placementAttempts.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type UserProfile = typeof userProfiles.$inferSelect;
export type PlacementAttempt = typeof placementAttempts.$inferSelect;
