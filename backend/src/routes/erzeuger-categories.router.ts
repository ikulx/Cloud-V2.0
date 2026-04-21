import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

const schema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
})

// GET /api/erzeuger-categories – liefert den gesamten Baum (flache Liste,
// Client baut den Baum via parentId). Inklusive zugeordneter Typen pro Knoten.
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

  // Zyklus-Schutz: parentId darf nicht auf sich selbst oder einen eigenen
  // Nachfahren zeigen.
  if (parsed.data.parentId) {
    if (parsed.data.parentId === req.params.id) {
      res.status(400).json({ message: 'Eigener Elternordner nicht erlaubt' })
      return
    }
    let cursor: string | null = parsed.data.parentId
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      if (cursor === req.params.id) {
        res.status(400).json({ message: 'Zyklus erkannt' })
        return
      }
      seen.add(cursor)
      const p: { parentId: string | null } | null = await prisma.erzeugerCategory.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      })
      cursor = p?.parentId ?? null
    }
  }

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

// DELETE /api/erzeuger-categories/:id – nur wenn keine Unterordner und keine Typen
router.delete('/:id', authenticate, requirePermission('roles:read'), async (req, res) => {
  const id = req.params.id as string
  const [typesCount, childCount] = await Promise.all([
    prisma.erzeugerType.count({ where: { categoryId: id } }),
    prisma.erzeugerCategory.count({ where: { parentId: id } }),
  ])
  if (typesCount > 0 || childCount > 0) {
    const parts: string[] = []
    if (childCount > 0) parts.push(`${childCount} Unterordner`)
    if (typesCount > 0) parts.push(`${typesCount} Typ${typesCount === 1 ? '' : 'en'}`)
    res.status(409).json({ message: `Enthält ${parts.join(' + ')} – zuerst leeren` })
    return
  }
  try {
    await prisma.erzeugerCategory.delete({ where: { id } })
    res.status(204).send()
  } catch {
    res.status(404).json({ message: 'Kategorie nicht gefunden' })
  }
})

export default router
