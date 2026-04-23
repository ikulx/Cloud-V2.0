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
const TYPES = ['EMAIL', 'SMS', 'EMAIL_AND_SMS', 'TELEGRAM'] as const

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
  /// Nur bei type = EMAIL_AND_SMS: Telefonnummer (E.164).
  smsTarget: z.string().max(40).nullable().optional(),
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
//  - interner Empfänger mit templateId → target darf leer sein (E-Mail kommt
//    aus dem zentralen Template; Piketdienst / Ygnis PM)
//  - interner Empfänger ohne templateId → eigene Adresse, target erforderlich
//  - externer Empfänger → target erforderlich
function validateRecipient(data: z.infer<typeof recipientSchema>): string | null {
  if (data.isInternal && data.type !== 'EMAIL') {
    return 'Interner Empfänger muss vom Typ EMAIL sein'
  }
  if (data.templateId) {
    // Template-basiert: target ist irrelevant (wird zur Versandzeit aus
    // dem Template aufgelöst).
    return null
  }
  if (!data.target?.trim()) return 'Empfänger-Adresse (target) erforderlich'
  // Bei SMS muss die Zielnummer im E.164-Format sein.
  if (data.type === 'SMS' && !/^\+[1-9]\d{7,14}$/.test(data.target.trim())) {
    return 'SMS-Empfänger muss im E.164-Format sein (z.B. +41791234567)'
  }
  // Bei EMAIL_AND_SMS: target = Mail, smsTarget = E.164-Nummer.
  if (data.type === 'EMAIL_AND_SMS') {
    const phone = (data.smsTarget ?? '').trim()
    if (!phone) return 'Telefonnummer für SMS erforderlich'
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return 'Telefonnummer muss im E.164-Format sein (z.B. +41791234567)'
    }
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
    include: { template: { select: { id: true, label: true, email: true, isSystem: true, schedule: true, priorities: true, delayMinutes: true } } } as never,
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
  const existing = await prisma.alarmRecipient.findUnique({
    where: { id: req.params.id as string },
    include: { template: { select: { isSystem: true } } } as never,
  })
  if (!existing) { res.status(404).json({ message: 'Empfänger nicht gefunden' }); return }
  const existingIsInternal = (existing as unknown as { isInternal: boolean }).isInternal
  if ((existingIsInternal || parsed.data.isInternal) && !isAdminRole(req.user?.roleName)) {
    res.status(403).json({ message: 'Nicht berechtigt, interne Empfänger zu verwalten' })
    return
  }

  // System-Template-Rows (Piketdienst, Ygnis PM): nur isActive darf editiert
  // werden. Alles andere kommt global aus dem Template.
  const existingTemplateIsSystem = !!(existing as unknown as { template?: { isSystem?: boolean } | null }).template?.isSystem
  if (existingTemplateIsSystem) {
    const allowed: Record<string, unknown> = {}
    if (parsed.data.isActive !== undefined) allowed.isActive = parsed.data.isActive
    const updated = await prisma.alarmRecipient.update({
      where: { id: req.params.id as string },
      data: allowed as never,
    })
    res.json(updated)
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
  const existing = await prisma.alarmRecipient.findUnique({
    where: { id: req.params.id as string },
    include: { template: { select: { isSystem: true } } } as never,
  })
  if (!existing) { res.status(404).json({ message: 'Empfänger nicht gefunden' }); return }
  const existingIsInternal = (existing as unknown as { isInternal: boolean }).isInternal
  if (existingIsInternal && !isAdminRole(req.user?.roleName)) {
    res.status(403).json({ message: 'Nicht berechtigt, interne Empfänger zu löschen' })
    return
  }
  const existingTemplateIsSystem = !!(existing as unknown as { template?: { isSystem?: boolean } | null }).template?.isSystem
  if (existingTemplateIsSystem) {
    res.status(400).json({ message: 'System-Empfänger (Piketdienst / Ygnis PM) können nicht gelöscht werden.' })
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

// POST /api/alarms/recipients/:id/test – sendet eine Test-Nachricht direkt
// an diesen Empfänger (E-Mail + SMS je nach Kanal). Keine Deliveries-Zeile,
// kein Rate-Limit-Check – rein für Admin-Test.
router.post('/recipients/:id/test', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const id = req.params.id as string
  const r = await prisma.alarmRecipient.findUnique({
    where: { id },
    include: { template: { select: { email: true } } } as never,
  })
  if (!r) { res.status(404).json({ message: 'Empfänger nicht gefunden' }); return }

  // Template-E-Mail bevorzugen, sonst target.
  const rAny = r as unknown as {
    type: string
    target: string
    smsTarget?: string | null
    templateId?: string | null
    template?: { email: string | null } | null
  }
  const emailTarget = rAny.templateId ? (rAny.template?.email ?? '').trim() : (rAny.target ?? '').trim()
  const smsTargetNumber = (rAny.smsTarget ?? '').trim() || (rAny.type === 'SMS' ? (rAny.target ?? '').trim() : '')

  const anlage = await prisma.anlage.findUnique({ where: { id: r.anlageId }, select: { name: true, projectNumber: true } })
  const anlageStr = anlage ? `${anlage.name}${anlage.projectNumber ? ' (' + anlage.projectNumber + ')' : ''}` : '—'
  const now = new Date()

  const results: Record<string, { ok: boolean; error?: string }> = {}

  // E-Mail, wenn type = EMAIL oder EMAIL_AND_SMS
  if ((rAny.type === 'EMAIL' || rAny.type === 'EMAIL_AND_SMS') && emailTarget) {
    try {
      const { sendAlarmMail } = await import('../services/mail.service')
      await sendAlarmMail(emailTarget, {
        priority: 'INFO',
        message: 'Test-Alarm (manuell ausgelöst) – Ihre Konfiguration funktioniert.',
        anlageName: anlageStr,
        projectNumber: anlage?.projectNumber ?? null,
        deviceName: 'Test-Gerät',
        serial: 'TEST',
        activatedAt: now,
        source: 'test',
      })
      results.email = { ok: true }
    } catch (err) {
      results.email = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // SMS, wenn type = SMS oder EMAIL_AND_SMS
  if ((rAny.type === 'SMS' || rAny.type === 'EMAIL_AND_SMS') && smsTargetNumber) {
    try {
      const { sendSms } = await import('../services/twilio.service')
      const body = `[Test] YControl: ${anlageStr} – Test-Alarm. Konfiguration OK.`
      const r2 = await sendSms(smsTargetNumber, body)
      results.sms = r2.ok ? { ok: true } : { ok: false, error: r2.error }
    } catch (err) {
      results.sms = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (Object.keys(results).length === 0) {
    res.status(400).json({ message: 'Empfänger hat keine gültige Zieladresse.' })
    return
  }
  res.json({ results })
})

// POST /api/alarms/events/:id/force-clear – Admin-Escape-Hatch.
// Setzt ein hängendes AlarmEvent auf CLEARED, ohne auf ein Pi-cleared-Event
// zu warten. Nützlich, wenn das cleared-MQTT-Signal verloren ging (Agent-
// Restart, Netzwerkabbruch) und der Alarm auf der Visu längst weg ist.
router.post('/events/:id/force-clear', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const id = req.params.id as string
  const existing = await prisma.alarmEvent.findUnique({ where: { id } })
  if (!existing) { res.status(404).json({ message: 'Alarm-Event nicht gefunden' }); return }
  if (existing.status !== 'ACTIVE') {
    res.status(400).json({ message: 'Alarm ist nicht aktiv' })
    return
  }
  const updated = await prisma.alarmEvent.update({
    where: { id: existing.id },
    data: { status: 'CLEARED', clearedAt: new Date() },
  })
  // Noch ausstehende Deliveries stornieren.
  await prisma.alarmEventDelivery.updateMany({
    where: { eventId: existing.id, status: 'PENDING' },
    data: { status: 'SKIPPED', errorMessage: 'force_cleared' },
  })
  console.log(`[Alarms] Event ${id} manuell als CLEARED markiert von ${req.user?.email}`)
  res.json(updated)
})

export default router
