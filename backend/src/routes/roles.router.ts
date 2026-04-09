import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

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
  const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: roleInclude })
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

  const role = await prisma.role.update({
    where: { id: req.params.id },
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
})

// DELETE /api/roles/:id
router.delete('/:id', authenticate, requirePermission('roles:delete'), async (req, res) => {
  await prisma.role.delete({ where: { id: req.params.id } })
  res.status(204).send()
})

export default router
