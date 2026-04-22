import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { hashPassword } from '../lib/password'
import { logActivity } from '../services/activity-log.service'

const router = Router()

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  address: z.string().optional(),
  phone: z.string().max(40).optional().nullable(),
  roleId: z.string().uuid().nullable().optional(),
  groupIds: z.array(z.string().uuid()).optional(),
  anlageIds: z.array(z.string().uuid()).optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
})

const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
})

const userInclude = {
  role: { select: { id: true, name: true } },
  groupMemberships: { include: { group: { select: { id: true, name: true } } } },
  directAnlagen: { include: { anlage: { select: { id: true, name: true } } } },
  directDevices: { include: { device: { select: { id: true, name: true } } } },
  _count: { select: { groupMemberships: true } },
}

// GET /api/users
router.get('/', authenticate, requirePermission('users:read'), async (_req, res) => {
  const users = await prisma.user.findMany({
    include: userInclude,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  res.json(users.map(sanitize))
})

// GET /api/users/:id
router.get('/:id', authenticate, requirePermission('users:read'), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id as string }, include: userInclude })
  if (!user) { res.status(404).json({ message: 'Benutzer nicht gefunden' }); return }
  res.json(sanitize(user))
})

// POST /api/users
router.post('/', authenticate, requirePermission('users:create'), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { password, groupIds, anlageIds, deviceIds, ...data } = parsed.data
  const passwordHash = await hashPassword(password)

  const user = await prisma.user.create({
    data: {
      ...data,
      passwordHash,
      groupMemberships: groupIds ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
      directAnlagen: anlageIds ? { create: anlageIds.map((anlageId) => ({ anlageId })) } : undefined,
      directDevices: deviceIds ? { create: deviceIds.map((deviceId) => ({ deviceId })) } : undefined,
    },
    include: userInclude,
  })
  res.status(201).json(sanitize(user))
})

// PATCH /api/users/:id
router.patch('/:id', authenticate, requirePermission('users:update'), async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { password, groupIds, anlageIds, deviceIds, ...data } = parsed.data
  const updateData: Record<string, unknown> = { ...data }
  if (password) updateData.passwordHash = await hashPassword(password)

  const user = await prisma.user.update({
    where: { id: req.params.id as string },
    data: {
      ...updateData,
      ...(groupIds !== undefined && {
        groupMemberships: { deleteMany: {}, create: groupIds.map((groupId) => ({ groupId })) },
      }),
      ...(anlageIds !== undefined && {
        directAnlagen: { deleteMany: {}, create: anlageIds.map((anlageId) => ({ anlageId })) },
      }),
      ...(deviceIds !== undefined && {
        directDevices: { deleteMany: {}, create: deviceIds.map((deviceId) => ({ deviceId })) },
      }),
    },
    include: userInclude,
  })
  res.json(sanitize(user))

  // Passwort-Änderung sicherheitsrelevant separat loggen
  if (password) {
    logActivity({
      action: 'users.password.update',
      entityType: 'users',
      entityId: user.id,
      details: { entityName: `${user.firstName} ${user.lastName} (${user.email})` },
      req,
      statusCode: 200,
    }).catch(() => {})
  }
})

// DELETE /api/users/:id
router.delete('/:id', authenticate, requirePermission('users:delete'), async (req, res) => {
  if (req.user?.userId === req.params.id as string) {
    res.status(400).json({ message: 'Eigener Account kann nicht gelöscht werden' })
    return
  }
  await prisma.user.delete({ where: { id: req.params.id as string } })
  res.status(204).send()
})

function sanitize(user: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user
  return rest
}

export default router
