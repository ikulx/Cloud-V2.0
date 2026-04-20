import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { env } from '../config/env'

interface TokenPayload {
  sub: string
  email: string
}

export function issueAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn as jwt.SignOptions['expiresIn'],
  })
}

export function issueRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.jwt.accessSecret) as TokenPayload
  } catch {
    return null
  }
}

export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.jwt.refreshSecret) as TokenPayload
  } catch {
    return null
  }
}

/**
 * Device-Secret-Hashing.
 *
 * Device-Secrets sind 32-Byte-Zufall (hex, 64 chars) — kryptografisch bereits
 * unbruteforcebar. Aber wir verwenden bcrypt, um auch automatisierte Audit-Scans
 * (CodeQL js/insufficient-password-hash) zu befriedigen und Defense-in-Depth
 * für den Fall eines DB-Leaks zu haben.
 *
 * Cost-Faktor 10 → ~50ms pro Verify auf modernen CPUs. Akzeptabel, da Pi's
 * nur selten (re-)verbinden.
 */
const BCRYPT_ROUNDS = 10

export function generateDeviceSecret(): { secret: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('hex')
  const hash = bcrypt.hashSync(secret, BCRYPT_ROUNDS)
  return { secret, hash }
}

/** Erzeugt einen neuen bcrypt-Hash für ein bereits bekanntes Secret. */
export function hashDeviceSecret(secret: string): string {
  return bcrypt.hashSync(secret, BCRYPT_ROUNDS)
}

/**
 * Constant-time Vergleich. Unterstützt:
 *   - bcrypt (neue Secrets, Hash beginnt mit $2)
 *   - HMAC-SHA256 mit MQTT_AUTH_SECRET (Legacy 1, hex)
 *   - plain SHA-256 (Legacy 2, hex — älteste Pis)
 *
 * Legacy-Pfade sind für Graceful Migration: bereits deployed'e Pis funktionieren
 * weiter, ohne Re-Provisioning. CodeQL-Suppressions sind explizit gesetzt, da die
 * veralteten Algorithmen NUR zum Vergleich mit existierenden DB-Hashes dienen,
 * nicht zur Neu-Erstellung.
 */
export function verifyDeviceSecret(plainSecret: string, storedHash: string): boolean {
  // Neuer bcrypt-Hash
  if (storedHash.startsWith('$2')) {
    return bcrypt.compareSync(plainSecret, storedHash)
  }

  // Legacy 1: HMAC-SHA256 (keyed mit MQTT_AUTH_SECRET) – hex output (64 chars)
  // lgtm[js/insufficient-password-hash]
  const hmac = crypto.createHmac('sha256', Buffer.from(env.mqttAuthSecret, 'utf-8'))
    .update(plainSecret)
    .digest('hex')
  if (hmac.length === storedHash.length && crypto.timingSafeEqual(
    Buffer.from(hmac, 'utf-8'),
    Buffer.from(storedHash, 'utf-8'),
  )) return true

  // Legacy 2: plain SHA-256 (älteste Pis aus Vor-HMAC-Zeit) – hex output
  // lgtm[js/insufficient-password-hash]
  const legacy = crypto.createHash('sha256').update(plainSecret).digest('hex')
  if (legacy.length === storedHash.length && crypto.timingSafeEqual(
    Buffer.from(legacy, 'utf-8'),
    Buffer.from(storedHash, 'utf-8'),
  )) return true

  return false
}
