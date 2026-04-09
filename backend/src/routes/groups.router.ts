import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

const groupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  userIds: z.array(z.string().uuid()).optional(),
  anlageIds: z.array(z.string().uuid()).optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
})

const groupInclude = {
  members: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
  groupAnlagen: { include: { anlage: { select: { id: true, name: true } } } },
  groupDevices: { include: { device: { select: { id: true, name: true } } } },
  _count: { select: { members: true } },
}

// GET /api/groups
router.get('/', authenticate, requirePermission('groups:read'), async (_req, res) => {
  const groups = await prisma.userGroup.findMany({ include: groupInclude, orderBy: { name: 'asc' } })
  res.json(groups)
})

// GET /api/groups/:id
router.get('/:id', authenticate, requirePermission('groups:read'), async (req, res) => {
  const group = await prisma.userGroup.findUnique({ where: { id: req.params.id as string }, include: groupInclude })
  if (!group) { res.status(404).json({ message: 'Gruppe nicht gefunden' }); return }
  res.json(group)
})

// POST /api/groups
router.post('/', authenticate, requirePermission('groups:create'), async (req, res) => {
  const parsed = groupSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { userIds, anlageIds, deviceIds, ...data } = parsed.data
  const group = await prisma.userGroup.create({
    data: {
      ...data,
      members: userIds ? { create: userIds.map((userId) => ({ userId })) } : undefined,
      groupAnlagen: anlageIds ? { create: anlageIds.map((anlageId) => ({ anlageId })) } : undefined,
      groupDevices: deviceIds ? { create: deviceIds.map((deviceId) => ({ deviceId })) } : undefined,
    },
    include: groupInclude,
  })
  res.status(201).json(group)
})

// PATCH /api/groups/:id
router.patch('/:id', authenticate, requirePermission('groups:update'), async (req, res) => {
  const parsed = groupSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { userIds, anlageIds, deviceIds, ...data } = parsed.data
  const group = await prisma.userGroup.update({
    where: { id: req.params.id as string },
    data: {
      ...data,
      ...(userIds !== undefined && {
        members: { deleteMany: {}, create: userIds.map((userId) => ({ userId })) },
      }),
      ...(anlageIds !== undefined && {
        groupAnlagen: { deleteMany: {}, create: anlageIds.map((anlageId) => ({ anlageId })) },
      }),
      ...(deviceIds !== undefined && {
        groupDevices: { deleteMany: {}, create: deviceIds.map((deviceId) => ({ deviceId })) },
      }),
    },
    include: groupInclude,
  })
  res.json(group)
})

// DELETE /api/groups/:id
router.delete('/:id', authenticate, requirePermission('groups:delete'), async (req, res) => {
  await prisma.userGroup.delete({ where: { id: req.params.id as string } })
  res.status(204).send()
})

export default router
