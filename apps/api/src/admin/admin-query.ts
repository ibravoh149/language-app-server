import { z } from 'zod';
import { AppError } from '../common/app-error';

/** Days window for dashboards: the last N UTC days including today. */
export const DaysSchema = z.coerce.number().int().min(1).max(90).default(30);

export const LimitSchema = z.coerce.number().int().min(1).max(100).default(25);

/** Start of the UTC day `days - 1` days ago. */
export function windowStart(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

/** Every UTC date in the window, oldest first ("YYYY-MM-DD"). */
export function windowDates(days: number): string[] {
  const start = windowStart(days);
  return Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

/** Opaque keyset cursor over (createdAt desc, id desc). */
export interface Cursor {
  at: string;
  id: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed.at === 'string' && typeof parsed.id === 'string' && !Number.isNaN(Date.parse(parsed.at))) return parsed;
  } catch {
    // fall through
  }
  throw new AppError('VALIDATION_FAILED', 'Invalid cursor.', { fields: { cursor: 'Invalid cursor.' } });
}
