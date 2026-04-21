import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

const schema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

// GET /api/erzeuger-categories – alle, inkl. Typen, für Dropdown im Anlage-UI
router.get('/', authenticate, requirePermission('anlagen:read'), async (_req, res) => {
  const cats = await prisma.erzeugerCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      types: {
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, isActive: true, sortOrder: true, serialRequired: true, categoryId: true },
      },
    },
  })
  res.json(cats)
})

// POST /api/erzeuger-categories – Admin
router.post('/', authenticate, requirePermission('roles:read'), async (req, res) => {
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  try {
    const created = await prisma.erzeugerCategory.create({ data: parsed.data })
    res.status(201).json(created)
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') { res.status(409).json({ message: 'Name existiert bereits' }); return }
    throw err
  }
})

// PATCH /api/erzeuger-categories/:id
router.patch('/:id', authenticate, requirePermission('roles:read'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  try {
    const updated = await prisma.erzeugerCategory.update({
      where: { id: req.params.id as string },
      data: parsed.data,
    })
    res.json(updated)
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') { res.status(409).json({ message: 'Name existiert bereits' }); return }
    res.status(404).json({ message: 'Kategorie nicht gefunden' })
  }
})

// DELETE /api/erzeuger-categories/:id – nur wenn keine Typen mehr in der Kategorie
router.delete('/:id', authenticate, requirePermission('roles:read'), async (req, res) => {
  const inUse = await prisma.erzeugerType.count({ where: { categoryId: req.params.id as string } })
  if (inUse > 0) {
    res.status(409).json({ message: `Enthält ${inUse} Typ${inUse === 1 ? '' : 'en'} – zuerst Typen entfernen` })
    return
  }
  try {
    await prisma.erzeugerCategory.delete({ where: { id: req.params.id as string } })
    res.status(204).send()
  } catch {
    res.status(404).json({ message: 'Kategorie nicht gefunden' })
  }
})

export default router
