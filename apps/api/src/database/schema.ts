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
export const turnRole = pgEnum('turn_role', ['user', 'ai']);
export const emailCodePurpose = pgEnum('email_code_purpose', ['verify_email', 'reset_password', 'delete_account']);

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
    /** A correct German translation the scorer compares against (other correct wordings are fine). */
    referenceText: text('reference_text'),
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

// ── Roleplay (F2) ─────────────────────────────────────────────────────────

/** Authored roleplay situations. The AI's opening line is scripted, so starting a session costs no LLM call. */
export const scenarios = pgTable('scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 60 }).notNull().unique(),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull(),
  emoji: varchar('emoji', { length: 16 }).notNull(),
  level: cefrLevel('level').notNull(),
  estimatedMinutes: integer('estimated_minutes').notNull(),
  situation: text('situation').notNull(),
  youAre: text('you_are').notNull(),
  aiIs: text('ai_is').notNull(),
  /** Server-only instructions for the AI character (who they are, how to steer the scene). */
  aiPersona: text('ai_persona').notNull(),
  openingLine: text('opening_line').notNull(),
  goals: jsonb('goals').$type<string[]>().notNull(),
  words: jsonb('words').$type<{ de: string; en: string }[]>().notNull(),
  phrases: jsonb('phrases').$type<string[]>().notNull(),
  grammar: jsonb('grammar').$type<string[]>().notNull(),
  active: boolean('active').default(true).notNull(),
  ...timestamps,
});

export const speakingSessions = pgTable(
  'speaking_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    scenarioId: uuid('scenario_id').notNull().references(() => scenarios.id),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    turnCount: integer('turn_count').default(0).notNull(),
    understoodCount: integer('understood_count').default(0).notNull(),
  },
  (t) => [index('speaking_sessions_user_idx').on(t.userId)],
);

export const sessionTurns = pgTable(
  'session_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => speakingSessions.id, { onDelete: 'cascade' }),
    role: turnRole('role').notNull(),
    text: text('text').notNull(),
    /** Learner turns only: 'voice' or 'text'. */
    inputMode: varchar('input_mode', { length: 8 }),
    /** Learner turns only: whether the tutor followed the meaning. */
    understood: boolean('understood'),
    /** AI turns only: LLM usage for the call that produced this reply (D10). */
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    ...timestamps,
  },
  (t) => [index('session_turns_session_idx').on(t.sessionId, t.createdAt)],
);

/** Corrections from every skill end up here; feeds the "Why" library later. */
export const corrections = pgTable(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => speakingSessions.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').references(() => sessionTurns.id, { onDelete: 'cascade' }),
    original: text('original').notNull(),
    corrected: text('corrected').notNull(),
    ruleKey: varchar('rule_key', { length: 80 }).notNull(),
    ruleName: text('rule_name').notNull(),
    explanation: text('explanation').notNull(),
    ...timestamps,
  },
  (t) => [index('corrections_session_idx').on(t.sessionId), index('corrections_user_idx').on(t.userId)],
);

/** Append-only log of genuine production ("spoke"); the source of truth for streaks and progress. */
export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 24 }).notNull(),
    refType: varchar('ref_type', { length: 32 }),
    refId: uuid('ref_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('activity_events_user_time_idx').on(t.userId, t.occurredAt)],
);

/** One row per user. A day counts when the learner produced ≥1 understood sentence (UTC days for now). */
export const streaks = pgTable('streaks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  current: integer('current').default(0).notNull(),
  longest: integer('longest').default(0).notNull(),
  /** "YYYY-MM-DD" (UTC) of the last day with production. */
  lastProducedDate: varchar('last_produced_date', { length: 10 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type UserProfile = typeof userProfiles.$inferSelect;
export type PlacementAttempt = typeof placementAttempts.$inferSelect;
export type Scenario = typeof scenarios.$inferSelect;
export type SpeakingSession = typeof speakingSessions.$inferSelect;
export type SessionTurn = typeof sessionTurns.$inferSelect;
