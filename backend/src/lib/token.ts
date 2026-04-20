import crypto from 'crypto'
import jwt from 'jsonwebtoken'
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
 * Device-Secrets sind kryptografisch zufällige 32-Byte-Werte (hex = 64 chars),
 * die vom Server generiert und einmalig an den Pi übergeben werden.
 * Sie sind KEINE Passwörter (kein low-entropy user-input), daher ist bcrypt/argon2
 * nicht nötig (und wäre bei jeder MQTT-Verbindung zu langsam).
 *
 * Stattdessen: HMAC-SHA256 mit dem server-seitigen MQTT_AUTH_SECRET.
 * Vorteile gegenüber blank SHA-256:
 *   - Angreifer der DB-Hash stiehlt kann ohne MQTT_AUTH_SECRET nichts
 *     vorberechnen (keyed hash, keine Rainbow-Tables anwendbar).
 *   - Konstante Ausführungszeit (timingSafeEqual beim Vergleich).
 */
function serverHmacKey(): Buffer {
  return Buffer.from(env.mqttAuthSecret, 'utf-8')
}

export function generateDeviceSecret(): { secret: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('hex')
  const hash = hashDeviceSecret(secret)
  return { secret, hash }
}

export function hashDeviceSecret(secret: string): string {
  return crypto.createHmac('sha256', serverHmacKey()).update(secret).digest('hex')
}

/** Constant-time Vergleich. Prüft sowohl neuen HMAC-Hash als auch das
 *  alte SHA-256-Schema (für bereits deployed'e Pis). */
export function verifyDeviceSecret(plainSecret: string, storedHash: string): boolean {
  // Neuer HMAC-Hash
  const hmac = hashDeviceSecret(plainSecret)
  if (hmac.length === storedHash.length && crypto.timingSafeEqual(
    Buffer.from(hmac, 'utf-8'), Buffer.from(storedHash, 'utf-8'),
  )) return true
  // Legacy-Fallback: altes SHA-256 ohne Schlüssel
  const legacy = crypto.createHash('sha256').update(plainSecret).digest('hex')
  if (legacy.length === storedHash.length && crypto.timingSafeEqual(
    Buffer.from(legacy, 'utf-8'), Buffer.from(storedHash, 'utf-8'),
  )) return true
  return false
}
