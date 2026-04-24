import crypto from 'crypto'
import { env } from '../config/env'

/**
 * Transparent-at-rest-Verschlüsselung für sensible Settings-Werte
 * (Backup-S3-Keys, Twilio-Auth-Token, SMTP-Passwort, DeepL-API-Key …).
 *
 * Format verschlüsselter Werte (als String in der DB):
 *   enc:v1:<base64(iv || authTag || ciphertext)>
 *
 * Wichtig:
 *   - Verschlüsselung ist AT REST, nicht zone-of-trust.  Wer die App-DB
 *     UND den SECRETS_KEY hat, kommt an die Klartexte.  Zweck ist das
 *     Schadenslimit bei reinem DB-Leak (dump, Backup, Replika).
 *   - Keys müssen stabil sein – ändert der SECRETS_KEY sich, lassen sich
 *     bestehende Werte nicht mehr entschlüsseln.  Deshalb in Prod
 *     erzwungen (validateProdSecrets) + Rotation-Plan über den Ops-Kanal.
 *   - Unverschlüsselte Werte werden VON decryptSecret transparent durch-
 *     gereicht, damit schon bestehende Daten ohne Migration lesbar bleiben
 *     und die Startup-Migration sie im Hintergrund ersetzen kann.
 */

const VERSION = 'v1'
const PREFIX = `enc:${VERSION}:`
const ALGO = 'aes-256-gcm'
const IV_LEN = 12          // Standard für GCM
const TAG_LEN = 16          // GCM-AuthTag
const KEY_LEN = 32          // AES-256

let cachedKey: Buffer | null = null

/** Leitet den 32-Byte-Schlüssel aus SECRETS_KEY (oder Dev-Fallback) ab. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey

  const raw = env.secretsKey?.trim()
  if (raw) {
    // Akzeptiert Hex (64 Zeichen), Base64 (44 Zeichen inkl. Padding) oder Raw-Text ≥32 Zeichen.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      cachedKey = Buffer.from(raw, 'hex')
    } else {
      // SHA-256 über den übergebenen Wert – damit ist jede Länge OK
      // (Deterministic, gleicher Input → gleicher Key).
      cachedKey = crypto.createHash('sha256').update(raw, 'utf8').digest()
    }
  } else {
    // Dev-Fallback: Key aus dem JWT-Access-Secret ableiten. In Prod schlägt
    // validateProdSecrets schon vorher Alarm, wenn SECRETS_KEY fehlt.
    cachedKey = crypto.createHash('sha256').update('ycontrol-secrets-v1:' + env.jwt.accessSecret, 'utf8').digest()
  }
  if (cachedKey.length !== KEY_LEN) {
    throw new Error('Secret-Key hat unerwartete Länge ' + cachedKey.length)
  }
  return cachedKey
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

export function encryptSecret(plain: string): string {
  if (!plain) return plain  // leere Werte lassen wir in Ruhe
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!isEncrypted(stored)) return stored  // Legacy-Klartext – Migration ersetzt das im Hintergrund
  try {
    const blob = Buffer.from(stored.slice(PREFIX.length), 'base64')
    const iv = blob.subarray(0, IV_LEN)
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const ct = blob.subarray(IV_LEN + TAG_LEN)
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv)
    decipher.setAuthTag(tag)
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString('utf8')
  } catch (e) {
    // Typisch: SECRETS_KEY wurde rotiert ohne vorherige Migration, oder der
    // Blob ist korrupt. Wir loggen kompakt (OHNE den Cipherblob!) und geben
    // leeren String zurück – so bricht nicht gleich der ganze Settings-Load.
    console.error('[secret-crypto] decrypt failed:', (e as Error).message)
    return ''
  }
}
