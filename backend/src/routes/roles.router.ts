import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { logActivity } from '../services/activity-log.service'

const router = Router()

const roleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  permissionIds: z.array(z.string().uuid()).optional(),
})

const roleInclude = {
  permissions: {
    include: { permission: { select: { id: true, key: true, description: true } } },
  },
  _count: { select: { users: true } },
}

// GET /api/roles
router.get('/', authenticate, requirePermission('roles:read'), async (_req, res) => {
  const roles = await prisma.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } })
  res.json(roles)
})

// GET /api/roles/:id
router.get('/:id', authenticate, requirePermission('roles:read'), async (req, res) => {
  const role = await prisma.role.findUnique({ where: { id: req.params.id as string }, include: roleInclude })
  if (!role) { res.status(404).json({ message: 'Rolle nicht gefunden' }); return }
  res.json(role)
})

// POST /api/roles
router.post('/', authenticate, requirePermission('roles:create'), async (req, res) => {
  const parsed = roleSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { name, description, permissionIds } = parsed.data
  const role = await prisma.role.create({
    data: {
      name,
      description,
      permissions: permissionIds
        ? { create: permissionIds.map((permissionId) => ({ permissionId })) }
        : undefined,
    },
    include: roleInclude,
  })
  res.status(201).json(role)
})

// PATCH /api/roles/:id
router.patch('/:id', authenticate, requirePermission('roles:update'), async (req, res) => {
  const parsed = roleSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { permissionIds, ...data } = parsed.data
  const roleId = req.params.id as string

  // Vor Update: aktuelle Permissions + Name sichern für Diff
  const before = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  })
  const beforeKeys = before?.permissions.map((p) => p.permission.key).sort() ?? []

  const role = await prisma.role.update({
    where: { id: roleId },
    data: {
      ...data,
      ...(permissionIds !== undefined && {
        permissions: {
          deleteMany: {},
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      }),
    },
    include: roleInclude,
  })
  res.json(role)

  // Permission-Änderungen explizit loggen (sicherheitsrelevant)
  if (permissionIds !== undefined && before) {
    const afterKeys = (role as unknown as { permissions?: Array<{ permission?: { key: string } }> })
      .permissions?.map((p) => p.permission?.key).filter(Boolean).sort() as string[] ?? []
    const added = afterKeys.filter((k) => !beforeKeys.includes(k))
    const removed = beforeKeys.filter((k) => !afterKeys.includes(k))
    if (added.length > 0 || removed.length > 0) {
      logActivity({
        action: 'roles.permissions.update',
        entityType: 'roles',
        entityId: role.id,
        details: {
          entityName: role.name,
          added,
          removed,
        },
        req,
        statusCode: 200,
      }).catch(() => {})
    }
  }
})

// DELETE /api/roles/:id
router.delete('/:id', authenticate, requirePermission('roles:delete'), async (req, res) => {
  await prisma.role.delete({ where: { id: req.params.id as string } })
  res.status(204).send()
})

export default router
