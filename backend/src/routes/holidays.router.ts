import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()
const ADMIN_PERM = 'roles:read'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any

// ── Regel-basierte Feiertage (jahresunabhängig) ─────────────────────────────

// GET /api/alarms/holidays/rules
router.get('/rules', authenticate, requirePermission(ADMIN_PERM), async (_req, res) => {
  const rules = await p.holidayRule.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })
  res.json(rules)
})

// PATCH /api/alarms/holidays/rules/:id – Admin toggelt v.a. isActive
const patchRuleSchema = z.object({
  isActive: z.boolean().optional(),
  label:    z.string().min(1).max(100).optional(),
  region:   z.string().max(10).nullable().optional(),
})
router.patch('/rules/:id', authenticate, requirePermission(ADMIN_PERM), async (req, res) => {
  const parsed = patchRuleSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  const existing = await p.holidayRule.findUnique({ where: { id: req.params.id as string } })
  if (!existing) { res.status(404).json({ message: 'Regel nicht gefunden' }); return }
  const data: Record<string, unknown> = {}
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
  if (parsed.data.label !== undefined) data.label = parsed.data.label
  if (parsed.data.region !== undefined) data.region = parsed.data.region
  const updated = await p.holidayRule.update({ where: { id: existing.id }, data })
  res.json(updated)
})

// ── Firmen-spezifische Einzeltage ────────────────────────────────────────────

// GET /api/alarms/holidays/dates
router.get('/dates', authenticate, requirePermission(ADMIN_PERM), async (_req, res) => {
  const dates = await p.holidayDate.findMany({ orderBy: { date: 'asc' } })
  res.json(dates)
})

const createDateSchema = z.object({
  date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1).max(100),
})

router.post('/dates', authenticate, requirePermission(ADMIN_PERM), async (req, res) => {
  const parsed = createDateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  try {
    const created = await p.holidayDate.create({
      data: {
        date: new Date(parsed.data.date + 'T00:00:00.000Z'),
        label: parsed.data.label,
      },
    })
    res.status(201).json(created)
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'P2002') { res.status(409).json({ message: 'Für dieses Datum existiert bereits ein Eintrag.' }); return }
    throw err
  }
})

router.delete('/dates/:id', authenticate, requirePermission(ADMIN_PERM), async (req, res) => {
  try {
    await p.holidayDate.delete({ where: { id: req.params.id as string } })
    res.status(204).send()
  } catch {
    res.status(404).json({ message: 'Eintrag nicht gefunden' })
  }
})

export default router
