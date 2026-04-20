import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../db/prisma'
import { issueAccessToken, issueRefreshToken, verifyRefreshToken } from '../lib/token'
import { comparePassword } from '../lib/password'
import { getUserAccessContext } from '../services/user-context.service'
import { authenticate } from '../middleware/authenticate'
import { logActivity } from '../services/activity-log.service'
import { loginRateLimiter, refreshRateLimiter } from '../middleware/rate-limit'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

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
      details: { email, remainingMin },
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
          details: { email, failedAttempts: newCount, lockedForMinutes: LOCKOUT_MINUTES },
          req,
          statusCode: 423,
        }).catch(() => {})
      }
    }
    logActivity({
      action: 'auth.login.failed',
      entityType: 'users',
      entityId: user?.id ?? null,
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
    action: 'auth.login',
    entityType: 'users',
    entityId: user.id,
    details: { email: user.email },
    req,
    statusCode: 200,
  }).catch(() => {})

  res.json({
    accessToken,
    refreshToken: refreshTokenRaw,
    me: { ...mapUser(user), permissions: userContext?.permissions ?? [] },
  })
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
