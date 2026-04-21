import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

// ──────────────────────────────────────────────────────────────────────────────
// Alarm-Empfänger (CRUD pro Anlage)
// ──────────────────────────────────────────────────────────────────────────────

const PRIORITIES = ['PRIO1', 'PRIO2', 'PRIO3', 'WARNING', 'INFO'] as const
const TYPES = ['EMAIL', 'SMS', 'TELEGRAM'] as const

const recipientSchema = z.object({
  type: z.enum(TYPES),
  target: z.string().min(1).max(200),
  label: z.string().max(100).nullable().optional(),
  priorities: z.array(z.enum(PRIORITIES)).default([]),
  delayMinutes: z.number().int().min(0).max(1440).default(0),
  isActive: z.boolean().default(true),
})

// GET /api/alarms/recipients?anlageId=...
router.get('/recipients', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const anlageId = typeof req.query.anlageId === 'string' ? req.query.anlageId : ''
  if (!anlageId) { res.status(400).json({ message: 'anlageId erforderlich' }); return }
  const recipients = await prisma.alarmRecipient.findMany({
    where: { anlageId },
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
  })
  res.json(recipients)
})

// POST /api/alarms/recipients – Body: recipientSchema + anlageId
router.post('/recipients', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const anlageId = typeof req.body.anlageId === 'string' ? req.body.anlageId : ''
  if (!anlageId) { res.status(400).json({ message: 'anlageId erforderlich' }); return }
  const parsed = recipientSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const anlage = await prisma.anlage.findUnique({ where: { id: anlageId }, select: { id: true } })
  if (!anlage) { res.status(404).json({ message: 'Anlage nicht gefunden' }); return }
  const created = await prisma.alarmRecipient.create({
    data: { ...parsed.data, anlageId },
  })
  res.status(201).json(created)
})

// PATCH /api/alarms/recipients/:id
router.patch('/recipients/:id', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const parsed = recipientSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  try {
    const updated = await prisma.alarmRecipient.update({
      where: { id: req.params.id as string },
      data: parsed.data,
    })
    res.json(updated)
  } catch {
    res.status(404).json({ message: 'Empfänger nicht gefunden' })
  }
})

// DELETE /api/alarms/recipients/:id
router.delete('/recipients/:id', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  try {
    await prisma.alarmRecipient.delete({ where: { id: req.params.id as string } })
    res.status(204).send()
  } catch {
    res.status(404).json({ message: 'Empfänger nicht gefunden' })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Alarm-Events (Historie + Live-Anzeige)
// ──────────────────────────────────────────────────────────────────────────────

// GET /api/alarms/events – Filter: anlageId, deviceId, status, priority, limit
router.get('/events', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const anlageId = typeof req.query.anlageId === 'string' ? req.query.anlageId : undefined
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined
  const limit = Math.min(
    500,
    Math.max(1, typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) || 100 : 100),
  )

  const where: Record<string, unknown> = {}
  if (anlageId) where.anlageId = anlageId
  if (deviceId) where.deviceId = deviceId
  if (status && ['ACTIVE', 'CLEARED', 'ACKNOWLEDGED'].includes(status)) where.status = status
  if (priority && (PRIORITIES as readonly string[]).includes(priority)) where.priority = priority

  const events = await prisma.alarmEvent.findMany({
    where,
    orderBy: { activatedAt: 'desc' },
    take: limit,
    include: {
      device: { select: { id: true, name: true, serialNumber: true } },
      anlage: { select: { id: true, name: true, projectNumber: true } },
      acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      deliveries: {
        select: {
          id: true, type: true, target: true, status: true,
          sentAt: true, errorMessage: true, createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  res.json(events)
})

// POST /api/alarms/events/:id/acknowledge – Event manuell quittieren
router.post('/events/:id/acknowledge', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const userId = req.user!.userId
  try {
    const updated = await prisma.alarmEvent.update({
      where: { id: req.params.id as string },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedById: userId,
      },
    })
    res.json(updated)
  } catch {
    res.status(404).json({ message: 'Event nicht gefunden' })
  }
})

export default router
