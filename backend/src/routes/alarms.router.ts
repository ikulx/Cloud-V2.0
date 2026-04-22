import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

// ──────────────────────────────────────────────────────────────────────────────
// Alarm-Empfänger (CRUD pro Anlage)
// ──────────────────────────────────────────────────────────────────────────────

const PRIORITIES = ['PRIO1', 'PRIO2', 'PRIO3', 'WARNING', 'INFO'] as const
const TYPES = ['EMAIL', 'SMS', 'TELEGRAM'] as const

// Wochenzeitplan: 7 Einträge (Mo..So), pro Tag 0..n Zeitfenster.
// Legacy-Format ({enabled,start,end}) wird zur Vorwärts-Kompatibilität
// im selben Schema toleriert (z.union mit beiden Shapes).
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const scheduleWindowSchema = z.object({
  start: z.string().regex(HHMM_RE, 'HH:MM'),
  end:   z.string().regex(HHMM_RE, 'HH:MM'),
})
const scheduleDaySchema = z.union([
  // v2: {enabled, windows: [...]}
  z.object({
    enabled: z.boolean(),
    windows: z.array(scheduleWindowSchema).max(6),
  }),
  // v1 legacy: {enabled, start, end}
  z.object({
    enabled: z.boolean(),
    start: z.string().regex(HHMM_RE, 'HH:MM'),
    end:   z.string().regex(HHMM_RE, 'HH:MM'),
  }),
])
const scheduleSchema = z.object({
  mode: z.enum(['always', 'weekly']),
  days: z.array(scheduleDaySchema).length(7).optional(),
}).nullable().optional()

const recipientSchema = z.object({
  type: z.enum(TYPES),
  target: z.string().min(1).max(200),
  label: z.string().max(100).nullable().optional(),
  priorities: z.array(z.enum(PRIORITIES)).default([]),
  delayMinutes: z.number().int().min(0).max(1440).default(0),
  schedule: scheduleSchema,
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
  // Prisma's Json-Felder akzeptieren kein nacktes `null`; entweder
  // `Prisma.JsonNull` (=SQL NULL) oder Feld weglassen.
  const { schedule, ...rest } = parsed.data
  const created = await prisma.alarmRecipient.create({
    data: {
      ...rest,
      anlageId,
      ...(schedule === undefined ? {} : { schedule: schedule === null ? Prisma.JsonNull : schedule }),
    },
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
  const { schedule, ...rest } = parsed.data
  try {
    const updated = await prisma.alarmRecipient.update({
      where: { id: req.params.id as string },
      data: {
        ...rest,
        ...(schedule === undefined ? {} : { schedule: schedule === null ? Prisma.JsonNull : schedule }),
      },
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

// GET /api/alarms/events – zeigt standardmässig NUR aktive Alarme.
// Quittieren auf der Cloud wurde bewusst entfernt – der Pi bestimmt, wann ein
// Alarm aktiv ist (und schickt "cleared", wenn die Auslösebedingung weg ist).
// Clients können explizit ?status=CLEARED / ACKNOWLEDGED setzen, das bleibt
// unterstützt für evtl. Audit-Views.
router.get('/events', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const anlageId = typeof req.query.anlageId === 'string' ? req.query.anlageId : undefined
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined
  const status = typeof req.query.status === 'string' ? req.query.status : 'ACTIVE'
  const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined
  const limit = Math.min(
    500,
    Math.max(1, typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) || 100 : 100),
  )

  const where: Record<string, unknown> = {}
  if (anlageId) where.anlageId = anlageId
  if (deviceId) where.deviceId = deviceId
  if (['ACTIVE', 'CLEARED', 'ACKNOWLEDGED'].includes(status)) where.status = status
  else if (status !== 'ALL') where.status = 'ACTIVE'
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

// Hinweis: Es gibt bewusst KEIN Acknowledge-Endpoint mehr. Der Alarm-Lifecycle
// ist Pi-seitig: ACTIVE bei Auslösung, CLEARED beim Wegfall. Die Cloud zeigt
// nur den aktuellen Zustand, kein manuelles Quittieren.

export default router
