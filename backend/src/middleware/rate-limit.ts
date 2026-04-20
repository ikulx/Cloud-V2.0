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
  skip: (req) => {
    const p = req.path
    return p.startsWith('/devices/register')
        || p.startsWith('/vpn/device-config')
        || p.startsWith('/health')
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
 * Test-Mail: 5 pro Stunde.
 */
export const testMailRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Test-Mail-Limit erreicht, bitte später erneut.' },
})
