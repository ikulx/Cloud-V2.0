import { Router } from 'express'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

// GET /api/permissions
router.get('/', authenticate, requirePermission('roles:read'), async (_req, res) => {
  const permissions = await prisma.permission.findMany({ orderBy: { key: 'asc' } })
  res.json(permissions)
})

export default router
