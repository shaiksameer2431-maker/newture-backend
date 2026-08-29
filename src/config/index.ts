/** Application configuration helpers. */
import 'dotenv/config';
import crypto from 'node:crypto';
let ephemeralSecret: string | null = null;
if (!process.env.JWT_SECRET) {
  ephemeralSecret = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV === 'production') {
    console.warn('[SECURITY WARNING] JWT_SECRET is not configured in production environment variables. Using a generated session secret for this instance. For persistent multi-instance sessions, configure JWT_SECRET in your dashboard.');
  } else {
    console.warn('[SECURITY] JWT_SECRET is unset; using an ephemeral development-only secret.');
  }
}
export function getPort(): number {
  return Number(process.env.PORT) || 10000;
}

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || ephemeralSecret!;
}

export function getCorsOrigin(): string | true | string[] {
  const origin = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS;
  if (!origin) return true;
  return origin.split(',').map((s) => s.trim()).filter(Boolean);
}
