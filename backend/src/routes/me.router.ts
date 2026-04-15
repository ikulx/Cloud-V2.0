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

export default router
