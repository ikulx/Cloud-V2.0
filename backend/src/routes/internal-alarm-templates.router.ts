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

// PATCH /api/alarms/internal-templates/:id – E-Mail editieren
const updateSchema = z.object({
  email: z.string().email().max(200).nullable().optional(),
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

  const updated = await p.internalAlarmRecipientTemplate.update({
    where: { id: existing.id },
    data,
  })
  res.json(updated)
})

export default router
