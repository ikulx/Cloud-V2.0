import crypto from 'crypto'

/**
 * Server-seitiger In-Memory-Store für LAN-Basic-Auth-Credentials.
 *
 * Problem: Credentials vom LAN-Device (Router, NAS etc.) wurden bisher als
 * Base64(user:password) im HttpOnly-Cookie gespeichert. Base64 ist aber keine
 * Verschlüsselung – der Client hätte die Credentials bei Cookie-Dump im Klartext.
 *
 * Lösung: Nur eine Session-ID (32 Byte Zufall) landet im Cookie. Die tatsächlichen
 * Credentials bleiben im Server-Speicher und haben eine TTL von 24h.
 */

interface SessionData {
  credentialsB64: string   // user:password base64-encoded (direkt als Authorization-Header nutzbar)
  expiresAt: number
}

const SESSIONS = new Map<string, SessionData>()
const TTL_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 10_000  // Schutz vor Memory-Exhaustion

function gc(): void {
  const now = Date.now()
  for (const [k, v] of SESSIONS.entries()) {
    if (v.expiresAt < now) SESSIONS.delete(k)
  }
  // Hard-Cap: bei Überlauf die ältesten raus
  if (SESSIONS.size > MAX_SESSIONS) {
    const entries = Array.from(SESSIONS.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    for (let i = 0; i < entries.length - MAX_SESSIONS; i++) SESSIONS.delete(entries[i][0])
  }
}

/** Speichert Credentials, gibt Session-ID zurück (für Cookie). */
export function storeLanBasicAuth(user: string, password: string): string {
  gc()
  const sessionId = crypto.randomBytes(32).toString('hex')
  const credentialsB64 = Buffer.from(`${user}:${password}`).toString('base64')
  SESSIONS.set(sessionId, { credentialsB64, expiresAt: Date.now() + TTL_MS })
  return sessionId
}

/** Holt Credentials via Session-ID (base64-encoded, direkt als Authorization-Header nutzbar). */
export function getLanBasicAuth(sessionId: string): string | null {
  const data = SESSIONS.get(sessionId)
  if (!data) return null
  if (data.expiresAt < Date.now()) {
    SESSIONS.delete(sessionId)
    return null
  }
  return data.credentialsB64
}

/** Entfernt eine Session. */
export function removeLanBasicAuth(sessionId: string): void {
  SESSIONS.delete(sessionId)
}
