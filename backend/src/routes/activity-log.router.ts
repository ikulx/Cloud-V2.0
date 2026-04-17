import { Router } from 'express'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

/**
 * GET /api/activity-log
 * Query-Parameter:
 *   limit       (default 100, max 500)
 *   offset      (default 0)
 *   search      (Freitext: matcht action prefix, entityName, userEmail)
 *   actions     (comma-separated action prefixes, z.B. "auth,vpn.visu")
 *   category    ("security" | "changes" | "remote" | "system" | "login")
 *   userEmail   (optional, exact match)
 *   userId      (optional)
 *   entityId    (optional)
 *   startDate   (ISO, inclusive)
 *   endDate     (ISO, inclusive)
 *   sort        ("desc" default | "asc")
 */
router.get('/', authenticate, requirePermission('activityLog:read'), async (req, res) => {
  const rawLimit = parseInt(String(req.query.limit ?? '100'))
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500)
  const rawOffset = parseInt(String(req.query.offset ?? '0'))
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0)

  const andConditions: Array<Record<string, unknown>> = []

  // Freitext: action prefix OR userEmail contains OR entityId contains
  if (typeof req.query.search === 'string' && req.query.search.trim().length > 0) {
    const q = req.query.search.trim()
    andConditions.push({
      OR: [
        { action: { startsWith: q } },
        { action: { contains: q } },
        { userEmail: { contains: q, mode: 'insensitive' } },
        { entityId: { equals: q } },
      ],
    })
  }

  // Action-Prefixe (comma-separated)
  if (typeof req.query.actions === 'string' && req.query.actions.trim().length > 0) {
    const prefixes = req.query.actions.split(',').map((s) => s.trim()).filter(Boolean)
    if (prefixes.length > 0) {
      andConditions.push({
        OR: prefixes.map((p) => ({ action: { startsWith: p } })),
      })
    }
  }

  // Semantische Kategorien
  if (typeof req.query.category === 'string') {
    const cat = req.query.category
    const byCategory: Record<string, string[]> = {
      security:  ['permission.denied', 'users.password.update', 'roles.permissions.update', 'auth.login.failed'],
      changes:   ['anlagen.', 'devices.', 'users.', 'groups.', 'roles.'],
      remote:    ['vpn.visu.open', 'vpn.deploy', 'vpn.config.download', 'devices.command.'],
      system:    ['system.'],
      login:     ['auth.login', 'auth.logout'],
    }
    const prefixes = byCategory[cat]
    if (prefixes) {
      andConditions.push({
        OR: prefixes.map((p) => p.endsWith('.')
          ? { action: { startsWith: p } }
          : { action: { equals: p } }),
      })
    }
  }

  if (typeof req.query.userId === 'string' && req.query.userId.length > 0) {
    andConditions.push({ userId: req.query.userId })
  }
  if (typeof req.query.userEmail === 'string' && req.query.userEmail.length > 0) {
    andConditions.push({ userEmail: req.query.userEmail })
  }
  if (typeof req.query.entityId === 'string' && req.query.entityId.length > 0) {
    andConditions.push({ entityId: req.query.entityId })
  }

  // Zeitraum
  const dateFilter: Record<string, Date> = {}
  if (typeof req.query.startDate === 'string' && req.query.startDate) {
    const d = new Date(req.query.startDate)
    if (!isNaN(d.getTime())) dateFilter.gte = d
  }
  if (typeof req.query.endDate === 'string' && req.query.endDate) {
    const d = new Date(req.query.endDate)
    if (!isNaN(d.getTime())) dateFilter.lte = d
  }
  if (Object.keys(dateFilter).length > 0) {
    andConditions.push({ createdAt: dateFilter })
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {}
  const sort: 'asc' | 'desc' = req.query.sort === 'asc' ? 'asc' : 'desc'

  const [total, entries] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: sort },
      take: limit,
      skip: offset,
    }),
  ])

  res.json({ total, limit, offset, entries })
})

/**
 * GET /api/activity-log/users
 * Liste der distinct User (Email) aus dem Log – für den User-Filter im Frontend.
 */
router.get('/users', authenticate, requirePermission('activityLog:read'), async (_req, res) => {
  const users = await prisma.activityLog.findMany({
    where: { userEmail: { not: null } },
    select: { userId: true, userEmail: true },
    distinct: ['userEmail'],
    orderBy: { userEmail: 'asc' },
  })
  res.json(users.filter((u) => u.userEmail !== null))
})

export default router
