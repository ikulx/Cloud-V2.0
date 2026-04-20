import crypto from 'crypto'

/**
 * Single-Use-Tickets für Visu-Iframe-Zugriff.
 *
 * Problem: JWT in URL (?access_token=...) landet in Browser-History, Referer,
 * Server-Access-Logs. Das JWT ist 15 Min gültig und gibt vollen API-Zugriff.
 *
 * Lösung: Client holt per authentifiziertem POST ein Einmal-Ticket (32 Byte
 * Zufall, 30 Sek TTL). Beim Visu-Aufruf wird das Ticket übergeben, validiert,
 * gegen Cookie getauscht und aus dem Store entfernt → keine Replay-Angriffe,
 * keine langlebigen Credentials in URLs.
 */

interface TicketData {
  userId: string
  email: string
  deviceId: string
  expiresAt: number
}

const TICKETS = new Map<string, TicketData>()
const TTL_MS = 30 * 1000

/** Aufräumen abgelaufener Tickets (wird bei jedem issue/consume aufgerufen). */
function gc(): void {
  const now = Date.now()
  for (const [k, v] of TICKETS.entries()) {
    if (v.expiresAt < now) TICKETS.delete(k)
  }
}

export function issueVisuTicket(userId: string, email: string, deviceId: string): {
  ticket: string
  expiresAt: number
} {
  gc()
  const ticket = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + TTL_MS
  TICKETS.set(ticket, { userId, email, deviceId, expiresAt })
  return { ticket, expiresAt }
}

/** Konsumiert das Ticket (single-use). Gibt null zurück wenn ungültig/abgelaufen. */
export function consumeVisuTicket(ticket: string, deviceId: string): {
  userId: string
  email: string
} | null {
  gc()
  const data = TICKETS.get(ticket)
  if (!data) return null
  TICKETS.delete(ticket)
  if (data.expiresAt < Date.now()) return null
  if (data.deviceId !== deviceId) return null
  return { userId: data.userId, email: data.email }
}
