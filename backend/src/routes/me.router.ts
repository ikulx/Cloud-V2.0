import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate'
import { prisma } from '../db/prisma'
import { comparePassword, hashPassword } from '../lib/password'

const router = Router()

// GET /api/me
router.get('/', authenticate, (req, res) => {
  res.json(req.user)
})

// PATCH /api/me – jeder eingeloggte User kann Name/Email/Passwort ändern
const updateMeSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(8).max(200).optional(),
})

router.patch('/', authenticate, async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Ungültige Daten', errors: parsed.error.flatten() })
  }

  const userId = req.user!.userId
  const data = parsed.data

  // Passwort-Änderung erfordert aktuelles Passwort
  const update: Record<string, unknown> = {}
  if (data.firstName !== undefined) update.firstName = data.firstName
  if (data.lastName !== undefined) update.lastName = data.lastName

  if (data.email !== undefined) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } })
    if (existing && existing.id !== userId) {
      return res.status(409).json({ message: 'E-Mail-Adresse bereits vergeben' })
    }
    update.email = data.email
  }

  if (data.newPassword) {
    if (!data.currentPassword) {
      return res.status(400).json({ message: 'Aktuelles Passwort erforderlich' })
    }
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return res.status(404).json({ message: 'User nicht gefunden' })
    const ok = await comparePassword(data.currentPassword, user.passwordHash)
    if (!ok) return res.status(403).json({ message: 'Aktuelles Passwort ist falsch' })
    update.passwordHash = await hashPassword(data.newPassword)
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ message: 'Keine Änderungen übermittelt' })
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: update,
    select: { id: true, email: true, firstName: true, lastName: true },
  })

  res.json(updated)
})

// GET /api/me/todos – Todos, die mir oder meinen Gruppen zugewiesen sind.
// Query-Parameter:
//   ?status=OPEN|DONE (default: OPEN)
//   ?scope=mine|groups|all (default: all)
router.get('/todos', authenticate, async (req, res) => {
  const userId = req.user!.userId
  const status = req.query.status === 'DONE' ? 'DONE' : req.query.status === 'OPEN' ? 'OPEN' : 'OPEN'
  const scope = (req.query.scope === 'mine' || req.query.scope === 'groups' || req.query.scope === 'all')
    ? req.query.scope : 'all'

  // Gruppen des Users ermitteln
  const memberships = await prisma.userGroupMember.findMany({
    where: { userId },
    select: { groupId: true },
  })
  const groupIds = memberships.map((m) => m.groupId)

  const orConditions: Array<Record<string, unknown>> = []
  if (scope === 'mine' || scope === 'all') {
    orConditions.push({ assignedUsers: { some: { userId } } })
  }
  if ((scope === 'groups' || scope === 'all') && groupIds.length > 0) {
    orConditions.push({ assignedGroups: { some: { groupId: { in: groupIds } } } })
  }
  if (orConditions.length === 0) { res.json([]); return }

  const todos = await prisma.anlageTodo.findMany({
    where: { status, OR: orConditions },
    include: {
      anlage: { select: { id: true, name: true, projectNumber: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      assignedUsers: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      assignedGroups: { include: { group: { select: { id: true, name: true } } } },
    },
    orderBy: [
      { dueDate: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'desc' },
    ],
  })

  // Pro Todo markieren, ob es direkt an mich (mine) oder über eine Gruppe (group) hängt.
  const enriched = todos.map((t) => {
    const mine = t.assignedUsers.some((au) => au.userId === userId)
    const viaGroup = t.assignedGroups.some((g) => groupIds.includes(g.groupId))
    return { ...t, assignmentMine: mine, assignmentViaGroup: viaGroup }
  })
  res.json(enriched)
})

export default router
