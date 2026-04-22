import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

/**
 * Admin-only: Verwaltung der globalen Template-Einträge für interne Alarm-
 * Empfänger. Es gibt nur die zwei geseedeten System-Einträge (Piketdienst,
 * Ygnis PM) – deren E-Mail-Adresse wird hier zentral gepflegt und vom
 * Dispatcher zur Versand-Zeit nachgeschlagen.
 *
 * Eigene interne Empfänger legen Admins direkt pro Anlage an – nicht global.
 * Deshalb gibt es hier kein POST/DELETE.
 *
 * `roles:read` dient als De-facto-Admin-Gate (Admin/Verwalter haben via
 * Code-Bypass alle Permissions, Kunden niemals).
 */

const ADMIN_PERM = 'roles:read'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any

// GET /api/alarms/internal-templates – alle Templates (sortiert)
router.get('/', authenticate, requirePermission(ADMIN_PERM), async (_req, res) => {
  const templates = await p.internalAlarmRecipientTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
  res.json(templates)
})

// PATCH /api/alarms/internal-templates/:id – Adresse/Zeitplan/Prio/Delay
const priorityEnum = z.enum(['PRIO1', 'PRIO2', 'PRIO3', 'WARNING', 'INFO'])
const scheduleWindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end:   z.string().regex(/^\d{2}:\d{2}$/),
})
const scheduleDaySchema = z.object({
  enabled: z.boolean(),
  windows: z.array(scheduleWindowSchema).max(8).optional(),
  start: z.string().optional(), // legacy
  end:   z.string().optional(),
})
const scheduleSchema = z.object({
  mode: z.enum(['always', 'weekly']),
  days: z.array(scheduleDaySchema).length(7).optional(),
})

const updateSchema = z.object({
  email:        z.string().email().max(200).nullable().optional(),
  schedule:     scheduleSchema.nullable().optional(),
  priorities:   z.array(priorityEnum).optional(),
  delayMinutes: z.number().int().min(0).max(1440).optional(),
  sendOnHoliday: z.boolean().optional(),
  deliveryChannel: z.enum(['EMAIL', 'PIKET_MANAGER']).optional(),
})

router.patch('/:id', authenticate, requirePermission(ADMIN_PERM), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const existing = await p.internalAlarmRecipientTemplate.findUnique({ where: { id: req.params.id as string } })
  if (!existing) { res.status(404).json({ message: 'Template nicht gefunden' }); return }

  const data: Record<string, unknown> = {}
  if (parsed.data.email !== undefined) data.email = parsed.data.email
  if (parsed.data.schedule !== undefined) {
    // Prisma.JsonNull für null
    data.schedule = parsed.data.schedule === null
      ? (await import('@prisma/client')).Prisma.JsonNull
      : parsed.data.schedule
  }
  if (parsed.data.priorities !== undefined) data.priorities = parsed.data.priorities
  if (parsed.data.delayMinutes !== undefined) data.delayMinutes = parsed.data.delayMinutes
  if (parsed.data.sendOnHoliday !== undefined) data.sendOnHoliday = parsed.data.sendOnHoliday
  if (parsed.data.deliveryChannel !== undefined) data.deliveryChannel = parsed.data.deliveryChannel

  const updated = await p.internalAlarmRecipientTemplate.update({
    where: { id: existing.id },
    data,
  })
  res.json(updated)
})

export default router
