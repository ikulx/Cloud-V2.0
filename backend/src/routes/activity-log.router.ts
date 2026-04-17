import { Router } from 'express'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

/**
 * GET /api/activity-log
 * Query-Parameter:
 *   limit     (default 100, max 500)
 *   offset    (default 0)
 *   action    (optional, Filter auf action prefix, z.B. "anlage" oder "anlage.create")
 *   userId    (optional)
 *   entityId  (optional)
 */
router.get('/', authenticate, requirePermission('activityLog:read'), async (req, res) => {
  const rawLimit = parseInt(String(req.query.limit ?? '100'))
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500)
  const rawOffset = parseInt(String(req.query.offset ?? '0'))
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0)

  const where: Record<string, unknown> = {}
  if (typeof req.query.action === 'string' && req.query.action.length > 0) {
    where.action = { startsWith: req.query.action }
  }
  if (typeof req.query.userId === 'string' && req.query.userId.length > 0) {
    where.userId = req.query.userId
  }
  if (typeof req.query.entityId === 'string' && req.query.entityId.length > 0) {
    where.entityId = req.query.entityId
  }

  const [total, entries] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
  ])

  res.json({ total, limit, offset, entries })
})

export default router
