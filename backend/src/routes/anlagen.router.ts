import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { buildVisibleAnlagenWhere } from '../lib/access-filter'

const router = Router()

const anlageSchema = z.object({
  projectNumber: z.string().max(50).optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  street: z.string().max(200).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  contactName: z.string().max(200).optional().nullable(),
  contactPhone: z.string().max(50).optional().nullable(),
  contactMobile: z.string().max(50).optional().nullable(),
  contactEmail: z.string().max(200).optional().nullable(),
  notes: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  plantType: z.enum(['HEAT_PUMP', 'BOILER']).optional().nullable(),
  deviceIds: z.array(z.string().uuid()).optional(),
  userIds: z.array(z.string().uuid()).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
})

const todoSchema = z.object({ title: z.string().min(1), details: z.string().optional() })
const todoUpdateSchema = z.object({ status: z.enum(['OPEN', 'DONE']) })
const logSchema = z.object({ message: z.string().min(1) })

const anlageInclude = {
  anlageDevices: { include: { device: { select: { id: true, name: true, status: true, isApproved: true } } } },
  directUsers: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
  groupAnlagen: { include: { group: { select: { id: true, name: true } } } },
  _count: { select: { anlageDevices: true, todos: true } },
}

// GET /api/anlagen
router.get('/', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const where = buildVisibleAnlagenWhere(req.user!)
  const anlagen = await prisma.anlage.findMany({ where, include: anlageInclude, orderBy: { name: 'asc' } })
  res.json(anlagen)
})

// GET /api/anlagen/:id
router.get('/:id', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const where = buildVisibleAnlagenWhere(req.user!)
  const anlage = await prisma.anlage.findFirst({
    where: { id: req.params.id as string as string, ...where },
    include: {
      ...anlageInclude,
      todos: { include: { createdBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
      logEntries: { include: { createdBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!anlage) { res.status(404).json({ message: 'Anlage nicht gefunden' }); return }
  res.json(anlage)
})

// POST /api/anlagen
router.post('/', authenticate, requirePermission('anlagen:create'), async (req, res) => {
  const parsed = anlageSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { deviceIds, userIds, groupIds, ...data } = parsed.data
  const anlage = await prisma.anlage.create({
    data: {
      ...data,
      anlageDevices: deviceIds ? { create: deviceIds.map((deviceId) => ({ deviceId })) } : undefined,
      directUsers: userIds ? { create: userIds.map((userId) => ({ userId })) } : undefined,
      groupAnlagen: groupIds ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
    },
    include: anlageInclude,
  })
  res.status(201).json(anlage)
})

// PATCH /api/anlagen/:id
router.patch('/:id', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const parsed = anlageSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { deviceIds, userIds, groupIds, ...data } = parsed.data
  const anlage = await prisma.anlage.update({
    where: { id: req.params.id as string },
    data: {
      ...data,
      ...(deviceIds !== undefined && {
        anlageDevices: { deleteMany: {}, create: deviceIds.map((deviceId) => ({ deviceId })) },
      }),
      ...(userIds !== undefined && {
        directUsers: { deleteMany: {}, create: userIds.map((userId) => ({ userId })) },
      }),
      ...(groupIds !== undefined && {
        groupAnlagen: { deleteMany: {}, create: groupIds.map((groupId) => ({ groupId })) },
      }),
    },
    include: anlageInclude,
  })
  res.json(anlage)
})

// DELETE /api/anlagen/:id
router.delete('/:id', authenticate, requirePermission('anlagen:delete'), async (req, res) => {
  await prisma.anlage.delete({ where: { id: req.params.id as string } })
  res.status(204).send()
})

// POST /api/anlagen/:id/todos
router.post('/:id/todos', authenticate, requirePermission('todos:create'), async (req, res) => {
  const parsed = todoSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const [todo] = await prisma.$transaction([
    prisma.anlageTodo.create({
      data: { anlageId: req.params.id as string, ...parsed.data, createdById: req.user!.userId },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.anlageLogEntry.create({
      data: {
        anlageId: req.params.id as string,
        message: `Todo erstellt: "${parsed.data.title}"`,
        createdById: req.user!.userId,
      },
    }),
  ])
  res.status(201).json(todo)
})

// PATCH /api/anlagen/:id/todos/:todoId
router.patch('/:id/todos/:todoId', authenticate, requirePermission('todos:update'), async (req, res) => {
  const parsed = todoUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const existing = await prisma.anlageTodo.findUnique({ where: { id: req.params.todoId as string }, select: { title: true } })
  const logMessage = parsed.data.status === 'DONE'
    ? `Todo abgehakt: "${existing?.title}"`
    : `Todo wieder geöffnet: "${existing?.title}"`
  const [todo] = await prisma.$transaction([
    prisma.anlageTodo.update({
      where: { id: req.params.todoId as string, anlageId: req.params.id as string },
      data: parsed.data,
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.anlageLogEntry.create({
      data: { anlageId: req.params.id as string, message: logMessage, createdById: req.user!.userId },
    }),
  ])
  res.json(todo)
})

// POST /api/anlagen/:id/logs
router.post('/:id/logs', authenticate, requirePermission('logbook:create'), async (req, res) => {
  const parsed = logSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const log = await prisma.anlageLogEntry.create({
    data: { anlageId: req.params.id as string, ...parsed.data, createdById: req.user!.userId },
    include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
  })
  res.status(201).json(log)
})

export default router
