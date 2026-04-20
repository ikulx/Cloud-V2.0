import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../db/prisma'
import { issueAccessToken, issueRefreshToken, verifyRefreshToken } from '../lib/token'
import { comparePassword, hashPassword } from '../lib/password'
import { getUserAccessContext } from '../services/user-context.service'
import { authenticate } from '../middleware/authenticate'
import { logActivity } from '../services/activity-log.service'
import {
  loginRateLimiter,
  refreshRateLimiter,
  verify2faRateLimiter,
  forgotPasswordRateLimiter,
  resetPasswordRateLimiter,
} from '../middleware/rate-limit'
import { sendLoginCodeMail, sendPasswordResetMail } from '../services/mail.service'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

const verify2faSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Code muss 6 Ziffern haben'),
})

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben'),
})

// Passwort-Reset-Parameter
const PASSWORD_RESET_TTL_MINUTES = 60

// 2FA-Parameter
const TWO_FA_TTL_MINUTES = 10
const TWO_FA_MAX_ATTEMPTS = 5

function needs2FA(role: { name: string; isSystem?: boolean } | null): boolean {
  if (!role) return false
  if (role.isSystem === true) return true
  return role.name === 'verwalter'
}

function generateLoginCode(): string {
  // 6 Ziffern, kryptografisch zufällig, führende Nullen erlaubt
  const n = crypto.randomInt(0, 1_000_000)
  return n.toString().padStart(6, '0')
}

async function issueTokensAndRespond(
  res: import('express').Response,
  req: import('express').Request,
  user: { id: string; email: string; firstName: string; lastName: string; role: { name: string; isSystem?: boolean } | null },
  viaTwoFactor: boolean,
) {
  const accessToken = issueAccessToken({ sub: user.id, email: user.email })
  const refreshTokenRaw = issueRefreshToken({ sub: user.id, email: user.email })
  const tokenHash = await bcrypt.hash(refreshTokenRaw, 10)

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  const userContext = await getUserAccessContext(user.id)

  logActivity({
    action: viaTwoFactor ? 'auth.login.2fa' : 'auth.login',
    entityType: 'users',
    entityId: user.id,
    userId: user.id,
    userEmail: user.email,
    details: { via2FA: viaTwoFactor },
    req,
    statusCode: 200,
  }).catch(() => {})

  res.json({
    accessToken,
    refreshToken: refreshTokenRaw,
    me: { ...mapUser(user), permissions: userContext?.permissions ?? [] },
  })
}

function mapUser(user: { id: string; email: string; firstName: string; lastName: string; role: { name: string; isSystem?: boolean } | null }) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleName: user.role?.name ?? null,
    isSystemRole: user.role?.isSystem === true,
  }
}

// POST /api/auth/login
const MAX_FAILED_LOGINS = 10
const LOCKOUT_MINUTES = 30

router.post('/login', loginRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }

  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({
    where: { email, isActive: true },
    include: { role: { select: { name: true, isSystem: true } } },
  })

  // Lockout-Check: wenn User existiert und lockedUntil in der Zukunft → blockieren
  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const remainingMs = user.lockedUntil.getTime() - Date.now()
    const remainingMin = Math.ceil(remainingMs / 60_000)
    logActivity({
      action: 'auth.login.blocked',
      entityType: 'users',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
      details: { remainingMin },
      req,
      statusCode: 423,
    }).catch(() => {})
    res.status(423).json({
      message: `Account wegen zu vieler fehlgeschlagener Anmeldungen gesperrt. Bitte in ${remainingMin} Min erneut versuchen.`,
    })
    return
  }

  if (!user || !(await comparePassword(password, user.passwordHash))) {
    // Fehlversuch: Counter erhöhen + ggf. sperren
    if (user) {
      const newCount = user.failedLoginCount + 1
      const shouldLock = newCount >= MAX_FAILED_LOGINS
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: newCount,
          lockedUntil: shouldLock
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null,
        },
      })
      if (shouldLock) {
        logActivity({
          action: 'auth.account.locked',
          entityType: 'users',
          entityId: user.id,
          userId: user.id,
          userEmail: user.email,
          details: { failedAttempts: newCount, lockedForMinutes: LOCKOUT_MINUTES },
          req,
          statusCode: 423,
        }).catch(() => {})
      }
    }
    logActivity({
      action: 'auth.login.failed',
      entityType: 'users',
      entityId: user?.id ?? null,
      userId: user?.id ?? null,
      userEmail: email,
      details: { email },
      req,
      statusCode: 401,
    }).catch(() => {})
    res.status(401).json({ message: 'E-Mail oder Passwort falsch' })
    return
  }

  // Erfolgreicher Login: Fail-Counter zurücksetzen
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    })
  }

  // 2FA für privilegierte Rollen (admin/verwalter): Challenge per E-Mail
  if (needs2FA(user.role)) {
    const code = generateLoginCode()
    const codeHash = await bcrypt.hash(code, 10)

    // Alte, ungenutzte Challenges des Users invalidieren
    await prisma.authChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })

    const challenge = await prisma.authChallenge.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + TWO_FA_TTL_MINUTES * 60_000),
        ipAddress: req.ip ?? null,
      },
    })

    // Mail-Versand asynchron – UI zeigt Code-Eingabe sofort an
    sendLoginCodeMail(user.email, code).catch((err) => {
      console.error('[auth/2fa] Mail-Versand fehlgeschlagen:', err)
    })

    logActivity({
      action: 'auth.2fa.challenge.issued',
      entityType: 'users',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
      req,
      statusCode: 200,
    }).catch(() => {})

    res.json({
      needs2FA: true,
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
      email: user.email,
    })
    return
  }

  await issueTokensAndRespond(res, req, user, false)
})

// POST /api/auth/verify-2fa
router.post('/verify-2fa', verify2faRateLimiter, async (req, res) => {
  const parsed = verify2faSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }

  const { challengeId, code } = parsed.data

  const challenge = await prisma.authChallenge.findUnique({
    where: { id: challengeId },
    include: {
      user: {
        include: { role: { select: { name: true, isSystem: true } } },
      },
    },
  })

  if (!challenge || !challenge.user.isActive) {
    res.status(401).json({ message: 'Code ungültig oder abgelaufen' })
    return
  }

  if (challenge.consumedAt) {
    res.status(401).json({ message: 'Code bereits verwendet – bitte neu anmelden' })
    return
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ message: 'Code abgelaufen – bitte neu anmelden' })
    return
  }

  if (challenge.attempts >= TWO_FA_MAX_ATTEMPTS) {
    // Challenge entwerten, damit weitere Versuche sofort fehlschlagen
    await prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    })
    logActivity({
      action: 'auth.2fa.challenge.exhausted',
      entityType: 'users',
      entityId: challenge.userId,
      userId: challenge.userId,
      userEmail: challenge.user.email,
      req,
      statusCode: 401,
    }).catch(() => {})
    res.status(401).json({ message: 'Zu viele Fehlversuche – bitte neu anmelden' })
    return
  }

  const ok = await bcrypt.compare(code, challenge.codeHash)
  if (!ok) {
    await prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    })
    logActivity({
      action: 'auth.2fa.verify.failed',
      entityType: 'users',
      entityId: challenge.userId,
      userId: challenge.userId,
      userEmail: challenge.user.email,
      details: { attempt: challenge.attempts + 1 },
      req,
      statusCode: 401,
    }).catch(() => {})
    res.status(401).json({ message: 'Code falsch' })
    return
  }

  // Erfolg: Challenge verbrauchen
  await prisma.authChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  })

  await issueTokensAndRespond(res, req, challenge.user, true)
})

// POST /api/auth/refresh
router.post('/refresh', refreshRateLimiter, async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe' })
    return
  }

  const { refreshToken } = parsed.data
  const payload = verifyRefreshToken(refreshToken)
  if (!payload) {
    res.status(401).json({ message: 'Refresh token ungültig' })
    return
  }

  const tokens = await prisma.refreshToken.findMany({
    where: {
      userId: payload.sub,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  })

  let matchedToken: (typeof tokens)[0] | null = null
  for (const t of tokens) {
    if (await bcrypt.compare(refreshToken, t.tokenHash)) {
      matchedToken = t
      break
    }
  }

  if (!matchedToken) {
    res.status(401).json({ message: 'Refresh token nicht gefunden oder abgelaufen' })
    return
  }

  // Revoke old token
  await prisma.refreshToken.update({
    where: { id: matchedToken.id },
    data: { revokedAt: new Date() },
  })

  const user = await prisma.user.findUnique({
    where: { id: payload.sub, isActive: true },
  })
  if (!user) {
    res.status(401).json({ message: 'Benutzer nicht gefunden' })
    return
  }

  const newAccessToken = issueAccessToken({ sub: user.id, email: user.email })
  const newRefreshTokenRaw = issueRefreshToken({ sub: user.id, email: user.email })
  const newTokenHash = await bcrypt.hash(newRefreshTokenRaw, 10)

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshTokenRaw })
})

// POST /api/auth/forgot-password
// Antwortet IMMER 200, auch wenn die Adresse unbekannt ist (keine User-Enumeration).
router.post('/forgot-password', forgotPasswordRateLimiter, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe' })
    return
  }

  const { email } = parsed.data
  const user = await prisma.user.findUnique({
    where: { email, isActive: true },
  })

  if (user) {
    // Alte, ungenutzte Reset-Tokens des Users invalidieren
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })

    // 32 Byte Zufall → URL-safe hex (64 chars)
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 10)

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
        ipAddress: req.ip ?? null,
      },
    })

    sendPasswordResetMail(user.email, rawToken).catch((err) => {
      console.error('[auth/forgot-password] Mail-Versand fehlgeschlagen:', err)
    })

    logActivity({
      action: 'auth.password.reset.requested',
      entityType: 'users',
      entityId: user.id,
      userId: user.id,
      userEmail: user.email,
      req,
      statusCode: 200,
    }).catch(() => {})
  } else {
    // Trotzdem loggen – interessant für Audit
    logActivity({
      action: 'auth.password.reset.requested.unknown',
      entityType: 'users',
      entityId: null,
      userEmail: email,
      details: { email },
      req,
      statusCode: 200,
    }).catch(() => {})
  }

  res.json({
    message: 'Falls ein Konto mit dieser E-Mail existiert, haben wir einen Link zum Zurücksetzen geschickt.',
  })
})

// POST /api/auth/reset-password
router.post('/reset-password', resetPasswordRateLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      message: 'Ungültige Eingabe',
      errors: parsed.error.flatten(),
    })
    return
  }

  const { token, password } = parsed.data

  // Alle aktiven Tokens holen und bcrypt-vergleichen (Tokens sind nicht im
  // Klartext in der DB, daher kein direkter lookup möglich).
  const candidates = await prisma.passwordResetToken.findMany({
    where: {
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  let matched: (typeof candidates)[0] | null = null
  for (const c of candidates) {
    if (await bcrypt.compare(token, c.tokenHash)) {
      matched = c
      break
    }
  }

  if (!matched) {
    res.status(401).json({ message: 'Link ist ungültig oder abgelaufen' })
    return
  }

  const user = await prisma.user.findUnique({
    where: { id: matched.userId, isActive: true },
  })
  if (!user) {
    res.status(401).json({ message: 'Benutzer nicht mehr verfügbar' })
    return
  }

  const newHash = await hashPassword(password)

  // Passwort setzen, Reset-Token verbrauchen, Lockout zurücksetzen und
  // alle laufenden Sessions (Refresh-Tokens) widerrufen.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: matched.id },
      data: { consumedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    // Laufende 2FA-Challenges ebenfalls invalidieren
    prisma.authChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
  ])

  logActivity({
    action: 'auth.password.reset.completed',
    entityType: 'users',
    entityId: user.id,
    userId: user.id,
    userEmail: user.email,
    req,
    statusCode: 200,
  }).catch(() => {})

  res.json({ message: 'Passwort wurde erfolgreich zurückgesetzt.' })
})

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  // Logout explizit loggen (unabhängig vom Erfolg des Token-Revokes)
  logActivity({
    action: 'auth.logout',
    entityType: 'users',
    entityId: req.user?.userId ?? null,
    req,
    statusCode: 204,
  }).catch(() => {})

  const parsed = refreshSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(204).send()
    return
  }

  const { refreshToken } = parsed.data
  const payload = verifyRefreshToken(refreshToken)
  if (!payload) {
    res.status(204).send()
    return
  }

  const tokens = await prisma.refreshToken.findMany({
    where: { userId: payload.sub, revokedAt: null },
  })

  for (const t of tokens) {
    if (await bcrypt.compare(refreshToken, t.tokenHash)) {
      await prisma.refreshToken.update({
        where: { id: t.id },
        data: { revokedAt: new Date() },
      })
      break
    }
  }

  res.status(204).send()
})

export default router
