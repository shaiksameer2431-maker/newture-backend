/** Application configuration helpers. */
import crypto from 'node:crypto';
const devJwtSecret = process.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex');
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set when NODE_ENV=production. Refusing to start.');
if (process.env.NODE_ENV !== 'production' && !process.env.JWT_SECRET) console.warn('[SECURITY] JWT_SECRET is unset; using an ephemeral development-only secret for this process.');
export function getPort(): number {
  return Number(process.env.PORT) || 3000;
}

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || devJwtSecret!;
}

export function getCorsOrigin(): string | true | string[] {
  if (!process.env.CORS_ORIGIN) return true;
  return process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
}
