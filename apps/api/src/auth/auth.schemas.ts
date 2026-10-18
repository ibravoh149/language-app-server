import { z } from 'zod';

export const LANGS = ['en', 'de', 'fr', 'es', 'tr', 'ar'] as const;
export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(255);
const password = z.string().min(8, 'Use at least 8 characters.').max(128, 'Use at most 128 characters.');
const code = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.');
const uuid = z.string().uuid();

export const ProfileSchema = z.object({
  interfaceLanguage: z.enum(LANGS),
  spokenLanguage: z.enum(LANGS),
  targetLanguage: z.literal('de'),
  selfRatedLevel: z.enum(CEFR).nullable(),
  suggestedLevel: z.enum(CEFR).nullable(),
  chosenLevel: z.enum(CEFR),
  dailyMinutes: z.union([z.literal(5), z.literal(15), z.literal(30)]),
  reminderEnabled: z.boolean(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h).'),
  voiceId: z.string().min(1).max(40),
  voiceSpeed: z.union([z.literal(0.75), z.literal(1), z.literal(1.25)]),
});
export type ProfileInput = z.infer<typeof ProfileSchema>;

export const SignupSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100),
  email,
  password,
  profile: ProfileSchema.optional(),
  assessmentId: uuid.optional(),
});

export const LoginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.').max(128) });
export const VerifyEmailSchema = z.object({ code });
export const ForgotPasswordSchema = z.object({ email });
export const ResetPasswordSchema = z.object({ email, code, newPassword: password });
export const RefreshSchema = z.object({ refreshToken: z.string().min(1).max(200) });

/** Deleting the account needs re-authentication: the password, or a code emailed via POST /me/delete/code. */
export const DeleteAccountSchema = z
  .object({ password: z.string().min(1).max(128).optional(), code: code.optional() })
  .refine((v) => !!v.password || !!v.code, { message: 'Enter your password or the code we emailed you.', path: ['password'] });

export const ProfilePatchSchema = ProfileSchema.partial().extend({ assessmentId: uuid.optional() });

export const GoogleSchema = z.object({
  idToken: z.string().min(1),
  profile: ProfileSchema.optional(),
  assessmentId: uuid.optional(),
});

export const AppleSchema = z.object({
  identityToken: z.string().min(1),
  name: z.string().trim().max(100).optional(),
  profile: ProfileSchema.optional(),
  assessmentId: uuid.optional(),
});
