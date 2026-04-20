import rateLimit from 'express-rate-limit'

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
 * Test-Mail: 5 pro Stunde.
 */
export const testMailRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Test-Mail-Limit erreicht, bitte später erneut.' },
})
