import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

/**
 * Admin-only: Verwaltung globaler Template-Einträge für interne Alarm-
 * Empfänger (Piketdienst, Ygnis PM, custom). Die E-Mail-Adresse wird hier
 * zentral gepflegt und vom Dispatcher zur Versand-Zeit nachgeschlagen.
 *
 * `roles:read` dient als De-facto-Admin-Gate (Admin/Verwalter haben via
 * Code-Bypass alle Permissions, Kunden niemals).
 */

const ADMIN_PERM = 'roles:read'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any

function isAdmin(roleName: string | null | undefined): boolean {
  return roleName === 'admin' || roleName === 'verwalter'
}

// GET /api/alarms/internal-templates – alle Templates (sortiert)
router.get('/', authenticate, requirePermission(ADMIN_PERM), async (_req, res) => {
  const templates = await p.internalAlarmRecipientTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
  res.json(templates)
})

// POST /api/alarms/internal-templates – neues Custom-Template
const createSchema = z.object({
  label: z.string().min(1).max(100),
  email: z.string().email().max(200).nullable().optional(),
  sortOrder: z.number().int().optional(),
})

router.post('/', authenticate, requirePermission(ADMIN_PERM), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  // Stabiler Key: label normalisiert + random suffix (damit zwei Templates
  // mit demselben Label nebeneinander existieren können und der Key
  // trotzdem eindeutig bleibt).
  const slug = parsed.data.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'custom'
  const key = `${slug}_${crypto.randomBytes(3).toString('hex')}`

  const created = await p.internalAlarmRecipientTemplate.create({
    data: {
      key,
      label: parsed.data.label,
      email: parsed.data.email ?? null,
      sortOrder: parsed.data.sortOrder ?? 100,
      isSystem: false,
    },
  })
  res.status(201).json(created)
})

// PATCH /api/alarms/internal-templates/:id – label + email editieren
const updateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).nullable().optional(),
  sortOrder: z.number().int().optional(),
})

router.patch('/:id', authenticate, requirePermission(ADMIN_PERM), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const existing = await p.internalAlarmRecipientTemplate.findUnique({ where: { id: req.params.id as string } })
  if (!existing) { res.status(404).json({ message: 'Template nicht gefunden' }); return }

  // System-Templates: Label kann nicht geändert werden (Piketdienst / Ygnis PM).
  const data: Record<string, unknown> = {}
  if (parsed.data.label !== undefined && !existing.isSystem) data.label = parsed.data.label
  if (parsed.data.email !== undefined) data.email = parsed.data.email
  if (parsed.data.sortOrder !== undefined && !existing.isSystem) data.sortOrder = parsed.data.sortOrder

  const updated = await p.internalAlarmRecipientTemplate.update({
    where: { id: existing.id },
    data,
  })
  res.json(updated)
})

// DELETE /api/alarms/internal-templates/:id – System-Templates geschützt
router.delete('/:id', authenticate, requirePermission(ADMIN_PERM), async (req, res) => {
  const existing = await p.internalAlarmRecipientTemplate.findUnique({ where: { id: req.params.id as string } })
  if (!existing) { res.status(404).json({ message: 'Template nicht gefunden' }); return }
  if (existing.isSystem) {
    res.status(409).json({ message: 'System-Templates können nicht gelöscht werden' })
    return
  }
  await p.internalAlarmRecipientTemplate.delete({ where: { id: existing.id } })
  res.status(204).send()
})

// Hilfsfunktion für alarms.router: filtert interne Empfänger aus, wenn der
// anfragende User kein Admin/Verwalter ist.
export function filterInternalForNonAdmin<T extends { isInternal?: boolean }>(
  items: T[], roleName: string | null | undefined,
): T[] {
  if (isAdmin(roleName)) return items
  return items.filter((i) => !i.isInternal)
}

export default router
