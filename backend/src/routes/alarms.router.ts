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
  // Externer Empfänger: type + target. Interner Empfänger: isInternal=true +
  // templateId, target darf leer sein (wird aus Template aufgelöst).
  type: z.enum(TYPES),
  target: z.string().max(200).default(''),
  label: z.string().max(100).nullable().optional(),
  priorities: z.array(z.enum(PRIORITIES)).default([]),
  delayMinutes: z.number().int().min(0).max(1440).default(0),
  schedule: scheduleSchema,
  isInternal: z.boolean().default(false),
  templateId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
})

function isAdminRole(roleName: string | null | undefined): boolean {
  return roleName === 'admin' || roleName === 'verwalter'
}

// Validiert Empfänger-Daten aus Benutzer-Sicht:
//  - interner Empfänger → muss templateId haben, type=EMAIL
//  - externer Empfänger → target muss gesetzt sein
function validateRecipient(data: z.infer<typeof recipientSchema>): string | null {
  if (data.isInternal) {
    if (!data.templateId) return 'Interner Empfänger benötigt ein Template'
    if (data.type !== 'EMAIL') return 'Interner Empfänger muss vom Typ EMAIL sein'
    // target darf leer sein; wird aus Template aufgelöst
  } else {
    if (!data.target?.trim()) return 'Empfänger-Adresse (target) erforderlich'
  }
  return null
}

// GET /api/alarms/recipients?anlageId=...
router.get('/recipients', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const anlageId = typeof req.query.anlageId === 'string' ? req.query.anlageId : ''
  if (!anlageId) { res.status(400).json({ message: 'anlageId erforderlich' }); return }
  const recipients = await prisma.alarmRecipient.findMany({
    where: { anlageId },
    orderBy: [{ isInternal: 'asc' }, { type: 'asc' }, { createdAt: 'asc' }] as never,
    include: { template: { select: { id: true, label: true, email: true, isSystem: true } } } as never,
  })
  // Kunden-Rollen sehen interne Empfänger nicht
  const filtered = isAdminRole(req.user?.roleName)
    ? recipients
    : recipients.filter((r) => !(r as unknown as { isInternal: boolean }).isInternal)
  res.json(filtered)
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
  // Interne Empfänger nur für Admins/Verwalter
  if (parsed.data.isInternal && !isAdminRole(req.user?.roleName)) {
    res.status(403).json({ message: 'Nicht berechtigt, interne Empfänger zu verwalten' })
    return
  }
  const validateErr = validateRecipient(parsed.data)
  if (validateErr) { res.status(400).json({ message: validateErr }); return }

  const anlage = await prisma.anlage.findUnique({ where: { id: anlageId }, select: { id: true } })
  if (!anlage) { res.status(404).json({ message: 'Anlage nicht gefunden' }); return }
  const { schedule, ...rest } = parsed.data
  const created = await prisma.alarmRecipient.create({
    data: {
      ...rest,
      anlageId,
      ...(schedule === undefined ? {} : { schedule: schedule === null ? Prisma.JsonNull : schedule }),
    } as never,
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
  // Bestehenden Recipient laden, um Admin-Only-Regel auch für Updates zu prüfen
  const existing = await prisma.alarmRecipient.findUnique({ where: { id: req.params.id as string } })
  if (!existing) { res.status(404).json({ message: 'Empfänger nicht gefunden' }); return }
  const existingIsInternal = (existing as unknown as { isInternal: boolean }).isInternal
  if ((existingIsInternal || parsed.data.isInternal) && !isAdminRole(req.user?.roleName)) {
    res.status(403).json({ message: 'Nicht berechtigt, interne Empfänger zu verwalten' })
    return
  }

  const { schedule, ...rest } = parsed.data
  try {
    const updated = await prisma.alarmRecipient.update({
      where: { id: req.params.id as string },
      data: {
        ...rest,
        ...(schedule === undefined ? {} : { schedule: schedule === null ? Prisma.JsonNull : schedule }),
      } as never,
    })
    res.json(updated)
  } catch {
    res.status(404).json({ message: 'Empfänger nicht gefunden' })
  }
})

// DELETE /api/alarms/recipients/:id
router.delete('/recipients/:id', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const existing = await prisma.alarmRecipient.findUnique({ where: { id: req.params.id as string } })
  if (!existing) { res.status(404).json({ message: 'Empfänger nicht gefunden' }); return }
  const existingIsInternal = (existing as unknown as { isInternal: boolean }).isInternal
  if (existingIsInternal && !isAdminRole(req.user?.roleName)) {
    res.status(403).json({ message: 'Nicht berechtigt, interne Empfänger zu löschen' })
    return
  }
  await prisma.alarmRecipient.delete({ where: { id: existing.id } })
  res.status(204).send()
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
