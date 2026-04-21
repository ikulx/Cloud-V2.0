import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

const typeSchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  serialRequired: z.boolean().optional(),
})

// GET /api/erzeuger-types – alle Rollen mit anlagen:read
router.get('/', authenticate, requirePermission('anlagen:read'), async (_req, res) => {
  const types = await prisma.erzeugerType.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { category: { select: { id: true, name: true, sortOrder: true, isActive: true } } },
  })
  res.json(types)
})

// POST /api/erzeuger-types – Admin (roles:read = nur Admin)
router.post('/', authenticate, requirePermission('roles:read'), async (req, res) => {
  const parsed = typeSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  try {
    const created = await prisma.erzeugerType.create({ data: parsed.data })
    res.status(201).json(created)
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ message: 'Name existiert bereits' })
      return
    }
    throw err
  }
})

// PATCH /api/erzeuger-types/:id
router.patch('/:id', authenticate, requirePermission('roles:read'), async (req, res) => {
  const parsed = typeSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  try {
    const updated = await prisma.erzeugerType.update({
      where: { id: req.params.id as string },
      data: parsed.data,
    })
    res.json(updated)
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ message: 'Name existiert bereits' })
      return
    }
    res.status(404).json({ message: 'Typ nicht gefunden' })
  }
})

// DELETE /api/erzeuger-types/:id – nur wenn kein Anlage-Eintrag darauf zeigt
router.delete('/:id', authenticate, requirePermission('roles:read'), async (req, res) => {
  const inUse = await prisma.anlageErzeuger.count({ where: { typeId: req.params.id as string } })
  if (inUse > 0) {
    res.status(409).json({ message: `In ${inUse} Anlage${inUse === 1 ? '' : 'n'} verwendet – nicht löschbar` })
    return
  }
  try {
    await prisma.erzeugerType.delete({ where: { id: req.params.id as string } })
    res.status(204).send()
  } catch {
    res.status(404).json({ message: 'Typ nicht gefunden' })
  }
})

export default router
