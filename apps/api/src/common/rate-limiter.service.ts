import { Injectable } from '@nestjs/common';
import { AppError } from './app-error';

/**
 * Fixed-window, in-memory rate limiter. Good for a single API instance;
 * move to Redis before running more than one (BACKLOG B-PLAT-4).
 * Limits are multiplied by 5 in development so manual testing isn't painful.
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly devFactor = process.env.NODE_ENV === 'production' ? 1 : 5;

  /** Records a hit for `key`; throws RATE_LIMITED when more than `limit` hits fall within `windowSec`. */
  hit(key: string, limit: number, windowSec: number) {
    const now = Date.now();
    const windowStart = now - windowSec * 1000;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (recent.length >= limit * this.devFactor) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowSec * 1000 - now) / 1000));
      throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait and try again.', { retryAfterSec });
    }
    recent.push(now);
    this.hits.set(key, recent);
  }
}
