import rateLimit from 'express-rate-limit'

/**
 * Generischer Rate-Limiter für alle /api/* Routes.
 * Verhindert allgemeinen API-Missbrauch (Scripted Scanning, DoS, etc.)
 * und beantwortet CodeQL `js/missing-rate-limiting`.
 *
 * 600 Requests/Minute/IP ist reichlich für legitime User (Activity-Log
 * Pagination, Frontend-Polling, Visu-Proxy-Sub-Ressourcen) und drosselt
 * nur bei aggressivem Scripted-Access.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Zu viele Anfragen. Bitte kurz warten.' },
  // Pi-Callback-Routes haben ihre eigene Auth und sollen nicht vom
  // IP-basierten Limiter betroffen sein (Pi's hinter NAT teilen evt. IPs).
  //
  // VPN-Proxy-Routen (/vpn/devices/:id/visu/** und /vpn/devices/:id/lan/**)
  // werden ebenfalls übersprungen:
  //  - Sie sind bereits authentifiziert (Visu-Ticket + User-Session).
  //  - Socket.IO verwendet long-polling als Fallback, wenn der WebSocket-
  //    Upgrade fehlschlägt – dabei entstehen pro Tab/Komponente mehrere
  //    HTTP-Requests pro Sekunde. Das Standard-600/min/IP-Limit wird dabei
  //    innerhalb weniger Minuten erreicht und kappt die Visu-Verbindung.
  skip: (req) => {
    const p = req.path
    if (p.startsWith('/devices/register')) return true
    if (p.startsWith('/vpn/device-config')) return true
    if (p.startsWith('/health')) return true
    // /vpn/devices/<deviceId>/visu/... oder /vpn/devices/<deviceId>/lan/...
    if (/^\/vpn\/devices\/[^/]+\/(visu|lan)(\/|$)/.test(p)) return true
    return false
  },
})

/**
 * Login: 10 Versuche pro 15 Min pro IP.
 * Nach Treffer erhält der Client 429 Too Many Requests + Retry-After.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,          // 15 Min
  max: 10,                            // 10 Versuche pro IP/Fenster
  standardHeaders: true,              // RateLimit-* Header zurückgeben
  legacyHeaders: false,
  message: { message: 'Zu viele Login-Versuche. Bitte warte 15 Minuten.' },
  skipSuccessfulRequests: true,       // Nur fehlgeschlagene Logins zählen
})

/**
 * Refresh: 60 Versuche pro 15 Min pro IP (Browser refresht alle paar Min auto).
 */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Zu viele Refresh-Requests.' },
})

/**
 * Invitations-Accept: 20 Versuche pro Stunde pro IP.
 * Schützt vor Brute-Force auf Einladungs-Tokens.
 */
export const inviteAcceptRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Zu viele Versuche, bitte später erneut.' },
})

/**
 * 2FA-Verify: 20 Versuche pro 15 Min pro IP (pro Challenge gibt es zusätzlich
 * eine DB-basierte Attempts-Sperre nach 5 Fehlversuchen).
 */
export const verify2faRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Zu viele Code-Versuche. Bitte neu anmelden.' },
})

/**
 * Passwort-Vergessen: 5 Versuche pro Stunde pro IP.
 * Verhindert E-Mail-Flood + User-Enumeration-Stress.
 */
export const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Zu viele Versuche. Bitte in einer Stunde erneut.' },
})

/**
 * Passwort-Reset (Token einlösen): 20 pro Stunde pro IP.
 */
export const resetPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Zu viele Versuche, bitte später erneut.' },
})

/**
 * Test-Mail: 5 pro Stunde.
 */
export const testMailRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Test-Mail-Limit erreicht, bitte später erneut.' },
})
