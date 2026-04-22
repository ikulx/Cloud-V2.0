import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()
const PERM_PLANNING = 'piket:planning:manage'
const PERM_LOG      = 'piket:log:read'
const PERM_READ_ALL = 'piket:alarms:read_all'
const PERM_READ_OWN = 'piket:alarms:read_own'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any

// ── Regionen ─────────────────────────────────────────────────────────────────

// GET /api/piket/regions
router.get('/regions', authenticate, requirePermission(PERM_PLANNING), async (_req, res) => {
  const regions = await p.piketRegion.findMany({
    orderBy: { name: 'asc' },
    include: {
      zipRanges: { orderBy: { fromZip: 'asc' } },
      foreignPrefixes: true,
      leader: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  res.json(regions)
})

const regionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
  leaderId: z.string().uuid().nullable().optional(),
  leaderFallbackEmail: z.string().email().max(200).nullable().optional(),
  smsToCallMinutes:    z.number().int().min(0).max(1440).nullable().optional(),
  callToLeaderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  zipRanges: z.array(z.object({
    fromZip: z.number().int().min(0).max(99999),
    toZip:   z.number().int().min(0).max(99999),
  })).default([]),
  foreignPrefixes: z.array(z.string().min(1).max(10)).default([]),
})

router.post('/regions', authenticate, requirePermission(PERM_PLANNING), async (req, res) => {
  const parsed = regionSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  const { zipRanges, foreignPrefixes, ...rest } = parsed.data
  const created = await p.piketRegion.create({
    data: {
      ...rest,
      zipRanges: { create: zipRanges },
      foreignPrefixes: { create: foreignPrefixes.map((prefix) => ({ prefix })) },
    },
    include: { zipRanges: true, foreignPrefixes: true, leader: { select: { id: true, firstName: true, lastName: true, email: true } } },
  })
  res.status(201).json(created)
})

router.patch('/regions/:id', authenticate, requirePermission(PERM_PLANNING), async (req, res) => {
  const parsed = regionSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  const id = req.params.id as string
  const { zipRanges, foreignPrefixes, ...rest } = parsed.data
  const updated = await p.piketRegion.update({
    where: { id },
    data: {
      ...rest,
      ...(zipRanges !== undefined ? {
        zipRanges: { deleteMany: {}, create: zipRanges },
      } : {}),
      ...(foreignPrefixes !== undefined ? {
        foreignPrefixes: { deleteMany: {}, create: foreignPrefixes.map((prefix) => ({ prefix })) },
      } : {}),
    },
    include: { zipRanges: true, foreignPrefixes: true, leader: { select: { id: true, firstName: true, lastName: true, email: true } } },
  })
  res.json(updated)
})

router.delete('/regions/:id', authenticate, requirePermission(PERM_PLANNING), async (req, res) => {
  await p.piketRegion.delete({ where: { id: req.params.id as string } })
  res.status(204).send()
})

// ── Schichten ───────────────────────────────────────────────────────────────

// GET /api/piket/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD&regionId=…
router.get('/shifts', authenticate, requirePermission(PERM_PLANNING), async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : ''
  const to   = typeof req.query.to   === 'string' ? req.query.to   : ''
  const regionId = typeof req.query.regionId === 'string' ? req.query.regionId : undefined

  const where: Record<string, unknown> = {}
  if (from) where.date = { gte: new Date(from + 'T00:00:00Z'), ...(to ? { lte: new Date(to + 'T00:00:00Z') } : {}) }
  if (regionId) where.regionId = regionId

  const shifts = await p.piketShift.findMany({
    where,
    orderBy: [{ date: 'asc' }, { regionId: 'asc' }],
    include: {
      region: { select: { id: true, name: true } },
      user:   { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  res.json(shifts)
})

const shiftSchema = z.object({
  regionId: z.string().uuid(),
  userId:   z.string().uuid(),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// POST /api/piket/shifts – upsert per (regionId, date)
router.post('/shifts', authenticate, requirePermission(PERM_PLANNING), async (req, res) => {
  const parsed = shiftSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  // Techniker MUSS eine Mobilnummer haben – sonst kann der Piket-Manager
  // weder SMS noch Anruf auslösen.
  const user = await p.user.findUnique({ where: { id: parsed.data.userId }, select: { phone: true, firstName: true, lastName: true } })
  if (!user) { res.status(404).json({ message: 'Techniker nicht gefunden' }); return }
  if (!user.phone || !user.phone.trim()) {
    res.status(400).json({
      message: `${user.firstName} ${user.lastName} hat keine Mobilnummer hinterlegt – bitte zuerst in der Benutzer­verwaltung eintragen.`,
      code: 'missing_phone',
    })
    return
  }
  if (!/^\+[1-9]\d{7,14}$/.test(user.phone.trim())) {
    res.status(400).json({
      message: `Die Mobilnummer von ${user.firstName} ${user.lastName} ist nicht im E.164-Format (z.B. +41791234567) – bitte in der Benutzerverwaltung korrigieren.`,
      code: 'invalid_phone',
    })
    return
  }

  const date = new Date(parsed.data.date + 'T00:00:00.000Z')
  const saved = await p.piketShift.upsert({
    where: { regionId_date: { regionId: parsed.data.regionId, date } },
    update: { userId: parsed.data.userId },
    create: { regionId: parsed.data.regionId, userId: parsed.data.userId, date },
    include: {
      region: { select: { id: true, name: true } },
      user:   { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  res.status(201).json(saved)
})

router.delete('/shifts/:id', authenticate, requirePermission(PERM_PLANNING), async (req, res) => {
  try { await p.piketShift.delete({ where: { id: req.params.id as string } }); res.status(204).send() }
  catch { res.status(404).json({ message: 'Schicht nicht gefunden' }) }
})

// ── Aktive Piket-Alarme + Ack ───────────────────────────────────────────────

// GET /api/piket/alarms?mine=1 – aktive Piket-Alarme.
// Zwei Stufen:
//  - piket:alarms:read_own → sieht nur seine eigenen (als Techniker zugewiesen)
//  - piket:alarms:read_all → sieht alle; kann mit ?mine=1 auf eigene einschränken
router.get('/alarms', authenticate, async (req, res) => {
  const perms = req.user?.permissions ?? []
  const canAll = perms.includes(PERM_READ_ALL)
  const canOwn = perms.includes(PERM_READ_OWN)
  if (!canAll && !canOwn) { res.status(403).json({ message: 'Keine Berechtigung' }); return }

  const userId = req.user?.userId
  const mineParam = req.query.mine === '1' || req.query.mine === 'true'
  // Wer nur read_own hat → wird immer auf sich selbst gefiltert.
  const effectiveMine = !canAll || mineParam

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    state: { in: ['PENDING_SMS', 'SMS_SENT', 'CALL_DUE', 'CALL_SENT', 'LEADER_DUE', 'LEADER_SENT'] },
  }
  if (effectiveMine && userId) where.techUserId = userId

  const alarms = await p.piketAlarmEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      region: { select: { id: true, name: true } },
      techUser:   { select: { id: true, firstName: true, lastName: true, email: true } },
      leaderUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      alarmEvent: {
        include: {
          device: { select: { id: true, name: true, serialNumber: true } },
          anlage: { select: { id: true, name: true, projectNumber: true } },
        },
      },
    },
  })
  res.json(alarms)
})

// GET /api/piket/alarms/log?days=30 – Historie aller Piket-Alarme (neueste zuerst)
router.get('/alarms/log', authenticate, requirePermission(PERM_LOG), async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(typeof req.query.days === 'string' ? req.query.days : '30', 10) || 30))
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await p.piketAlarmEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      region: { select: { id: true, name: true } },
      techUser:       { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      leaderUser:     { select: { id: true, firstName: true, lastName: true, email: true } },
      acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      alarmEvent: {
        select: {
          id: true, priority: true, message: true, activatedAt: true, clearedAt: true, status: true,
          device: { select: { id: true, name: true, serialNumber: true } },
          anlage: { select: { id: true, name: true, projectNumber: true } },
        },
      },
    },
  })
  res.json(rows)
})

// POST /api/piket/alarms/:id/ack – bestätigen.
// Eigene Alarme (techUserId = self) dürfen mit read_own quittiert werden;
// fremde Alarme nur mit read_all.
router.post('/alarms/:id/ack', authenticate, async (req, res) => {
  const id = req.params.id as string
  const existing = await p.piketAlarmEvent.findUnique({ where: { id } })
  if (!existing) { res.status(404).json({ message: 'Piket-Alarm nicht gefunden' }); return }
  const me = req.user?.userId
  if (!me) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const perms = req.user?.permissions ?? []
  const canAll = perms.includes(PERM_READ_ALL)
  const canOwn = perms.includes(PERM_READ_OWN)
  const isOwn  = existing.techUserId === me
  if (!canAll && !(canOwn && isOwn)) { res.status(403).json({ message: 'Keine Berechtigung' }); return }
  const updated = await p.piketAlarmEvent.update({
    where: { id },
    data: {
      state: 'ACKNOWLEDGED',
      acknowledgedAt: new Date(),
      acknowledgedById: me,
      nextActionAt: null,
    },
  })
  res.json(updated)
})

export default router
