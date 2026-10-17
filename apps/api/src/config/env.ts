import { Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';

const logger = new Logger('Env');
const isProduction = process.env.NODE_ENV === 'production';
const devFallbacks = new Map<string, string>();

/**
 * Required secret. In production a missing value stops the server; in development
 * a random per-process value is used (tokens then don't survive a restart).
 */
function secret(name: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production`);
  if (!devFallbacks.has(name)) {
    logger.warn(`${name} is not set; using a random value for this process (dev only)`);
    devFallbacks.set(name, randomBytes(32).toString('base64'));
  }
  return devFallbacks.get(name)!;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  get isProduction() {
    return isProduction;
  },
  get jwtAccessSecret() {
    return secret('JWT_ACCESS_SECRET');
  },
  get codeHmacSecret() {
    return secret('CODE_HMAC_SECRET');
  },
  get googleClientIds() {
    return list('GOOGLE_CLIENT_IDS');
  },
  get appleBundleId() {
    return process.env.APPLE_BUNDLE_ID || 'com.languageapp.sprachbar';
  },
  get llmServiceUrl() {
    return process.env.LLM_SERVICE_URL || 'http://localhost:8000';
  },
};

export const AUTH = {
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlSec: 30 * 24 * 60 * 60,
  codeTtlSec: 10 * 60,
  codeMaxAttempts: 5,
  resendCooldownSec: 60,
  resendPerHour: 5,
} as const;
