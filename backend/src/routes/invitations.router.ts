import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { hashPassword } from '../lib/password'
import { sendInvitationMail } from '../services/mail.service'

const router = Router()

// POST /api/invitations  –  Einladung erstellen + E-Mail senden
const createSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid().nullable().optional(),
  groupIds: z.array(z.string().uuid()).optional().default([]),
  anlageIds: z.array(z.string().uuid()).optional().default([]),
  deviceIds: z.array(z.string().uuid()).optional().default([]),
})

router.post('/', authenticate, requirePermission('users:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Ungültige Daten', errors: parsed.error.flatten() })
  }

  const { email, roleId, groupIds, anlageIds, deviceIds } = parsed.data

  // Prüfen ob User bereits existiert
  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    return res.status(409).json({ message: 'Ein Benutzer mit dieser E-Mail existiert bereits.' })
  }

  // Prüfen ob bereits eine offene Einladung existiert
  const existingInvite = await prisma.invitation.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: new Date() } },
  })
  if (existingInvite) {
    return res.status(409).json({ message: 'Es existiert bereits eine offene Einladung für diese E-Mail.' })
  }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 Tage

  const invitation = await prisma.invitation.create({
    data: {
      email,
      token,
      roleId: roleId ?? null,
      groupIds,
      anlageIds,
      deviceIds,
      expiresAt,
      invitedById: req.user!.userId,
    },
  })

  // E-Mail senden
  const inviterName = `${req.user!.firstName} ${req.user!.lastName}`
  try {
    await sendInvitationMail(email, inviterName, token)
  } catch (err) {
    console.error('[Invitation] E-Mail senden fehlgeschlagen:', err)
    // Einladung trotzdem behalten – Link kann manuell geteilt werden
  }

  res.status(201).json({
    id: invitation.id,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    token: invitation.token,
  })
})

// GET /api/invitations  –  alle Einladungen auflisten
router.get('/', authenticate, requirePermission('users:read'), async (_req, res) => {
  const invitations = await prisma.invitation.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      invitedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  })
  res.json(invitations)
})

// DELETE /api/invitations/:id  –  Einladung widerrufen
router.delete('/:id', authenticate, requirePermission('users:delete'), async (req, res) => {
  const id = req.params.id as string
  await prisma.invitation.delete({ where: { id } })
  res.status(204).end()
})

// POST /api/invitations/:id/resend  –  Einladung erneut senden
router.post('/:id/resend', authenticate, requirePermission('users:create'), async (req, res) => {
  const id = req.params.id as string
  const invitation = await prisma.invitation.findUnique({
    where: { id },
    include: { invitedBy: { select: { firstName: true, lastName: true } } },
  })
  if (!invitation) return res.status(404).json({ message: 'Einladung nicht gefunden' })
  if (invitation.usedAt) return res.status(400).json({ message: 'Einladung wurde bereits eingelöst' })

  // Token + Ablauf erneuern
  const newToken = crypto.randomBytes(32).toString('hex')
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { token: newToken, expiresAt: newExpiry },
  })

  const inviter = invitation.invitedBy
  const inviterName = `${inviter.firstName} ${inviter.lastName}`
  try {
    await sendInvitationMail(invitation.email, inviterName, newToken)
  } catch (err) {
    console.error('[Invitation] Resend fehlgeschlagen:', err)
  }

  res.json({ message: 'Einladung erneut gesendet' })
})

// ── Öffentliche Endpunkte (kein Auth nötig) ──────────────────────────

// GET /api/invitations/verify/:token  –  Token prüfen (Frontend zeigt Formular)
router.get('/verify/:token', async (req, res) => {
  const invitation = await prisma.invitation.findUnique({
    where: { token: req.params.token },
  })

  if (!invitation) return res.status(404).json({ message: 'Einladung nicht gefunden' })
  if (invitation.usedAt) return res.status(410).json({ message: 'Einladung wurde bereits eingelöst' })
  if (invitation.expiresAt < new Date()) return res.status(410).json({ message: 'Einladung ist abgelaufen' })

  res.json({ email: invitation.email })
})

// POST /api/invitations/accept/:token  –  Konto erstellen
const acceptSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
})

router.post('/accept/:token', async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Ungültige Daten', errors: parsed.error.flatten() })
  }

  const invitation = await prisma.invitation.findUnique({
    where: { token: req.params.token },
  })
  if (!invitation) return res.status(404).json({ message: 'Einladung nicht gefunden' })
  if (invitation.usedAt) return res.status(410).json({ message: 'Einladung wurde bereits eingelöst' })
  if (invitation.expiresAt < new Date()) return res.status(410).json({ message: 'Einladung ist abgelaufen' })

  // Prüfen ob E-Mail zwischenzeitlich vergeben wurde
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } })
  if (existing) {
    return res.status(409).json({ message: 'Ein Benutzer mit dieser E-Mail existiert bereits.' })
  }

  const { firstName, lastName, password } = parsed.data
  const passwordHash = await hashPassword(password)

  // User + Zuweisungen in einer Transaktion anlegen
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: invitation.email,
        passwordHash,
        firstName,
        lastName,
        roleId: invitation.roleId,
        isActive: true,
      },
    })

    // Gruppen-Zuweisungen
    if (invitation.groupIds.length > 0) {
      await tx.userGroupMember.createMany({
        data: invitation.groupIds.map((groupId) => ({ userId: newUser.id, groupId })),
      })
    }

    // Anlagen-Zuweisungen
    if (invitation.anlageIds.length > 0) {
      await tx.userDirectAnlage.createMany({
        data: invitation.anlageIds.map((anlageId) => ({ userId: newUser.id, anlageId })),
      })
    }

    // Geräte-Zuweisungen
    if (invitation.deviceIds.length > 0) {
      await tx.userDirectDevice.createMany({
        data: invitation.deviceIds.map((deviceId) => ({ userId: newUser.id, deviceId })),
      })
    }

    // Einladung als eingelöst markieren
    await tx.invitation.update({
      where: { id: invitation.id },
      data: { usedAt: new Date() },
    })

    return newUser
  })

  res.status(201).json({
    message: 'Konto erfolgreich erstellt. Sie können sich jetzt anmelden.',
    userId: user.id,
  })
})

export default router
