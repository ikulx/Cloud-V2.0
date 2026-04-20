import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

const authorSelect = {
  id: true, firstName: true, lastName: true, email: true,
} as const

/** Erzeugt einen URL-freundlichen Slug. Bei Kollision wird eine Zufallsendung
 *  angehängt. */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return base || 'seite'
}

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title)
  let slug = base
  let i = 1
  while (await prisma.wikiPage.findUnique({ where: { slug } })) {
    slug = `${base}-${++i}`
    if (i > 50) { slug = `${base}-${Math.random().toString(36).slice(2, 8)}`; break }
  }
  return slug
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  icon: z.string().max(8).optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  content: z.unknown().optional(), // TipTap JSON
})

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  content: z.unknown().optional(),
  sortOrder: z.number().int().optional(),
})

// GET /api/wiki/tree – leichtgewichtiger Seitenbaum für die Sidebar
router.get('/tree', authenticate, requirePermission('wiki:read'), async (_req, res) => {
  const pages = await prisma.wikiPage.findMany({
    select: { id: true, title: true, icon: true, parentId: true, sortOrder: true, slug: true, updatedAt: true },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
  })
  res.json(pages)
})

// GET /api/wiki/pages/:id – einzelne Seite mit Inhalt + Autor-Meta
router.get('/pages/:id', authenticate, requirePermission('wiki:read'), async (req, res) => {
  const page = await prisma.wikiPage.findUnique({
    where: { id: req.params.id as string },
    include: {
      createdBy: { select: authorSelect },
      updatedBy: { select: authorSelect },
    },
  })
  if (!page) { res.status(404).json({ message: 'Seite nicht gefunden' }); return }
  res.json(page)
})

// POST /api/wiki/pages – neue Seite
router.post('/pages', authenticate, requirePermission('wiki:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const userId = req.user!.userId

  // sortOrder: hinter die letzte Geschwisterseite setzen
  const last = await prisma.wikiPage.findFirst({
    where: { parentId: parsed.data.parentId ?? null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  const slug = await uniqueSlug(parsed.data.title)

  const page = await prisma.wikiPage.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? null,
      parentId: parsed.data.parentId ?? null,
      content: (parsed.data.content ?? { type: 'doc', content: [] }) as object,
      slug,
      sortOrder: (last?.sortOrder ?? 0) + 10,
      createdById: userId,
      updatedById: userId,
    },
    include: {
      createdBy: { select: authorSelect },
      updatedBy: { select: authorSelect },
    },
  })
  res.status(201).json(page)
})

// PATCH /api/wiki/pages/:id – Inhalt/Meta aktualisieren
router.patch('/pages/:id', authenticate, requirePermission('wiki:update'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const userId = req.user!.userId

  // Eine Seite darf nicht zu einem eigenen Nachfahren verschoben werden (Zyklus)
  if (parsed.data.parentId) {
    let cursor: string | null = parsed.data.parentId
    while (cursor) {
      if (cursor === req.params.id) {
        res.status(400).json({ message: 'Ungültige Verschiebung (Zyklus)' })
        return
      }
      const p: { parentId: string | null } | null = await prisma.wikiPage.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      })
      cursor = p?.parentId ?? null
    }
  }

  try {
    const page = await prisma.wikiPage.update({
      where: { id: req.params.id as string },
      data: {
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.icon !== undefined && { icon: parsed.data.icon }),
        ...(parsed.data.parentId !== undefined && { parentId: parsed.data.parentId }),
        ...(parsed.data.content !== undefined && { content: parsed.data.content as object }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
        updatedById: userId,
      },
      include: {
        createdBy: { select: authorSelect },
        updatedBy: { select: authorSelect },
      },
    })
    res.json(page)
  } catch {
    res.status(404).json({ message: 'Seite nicht gefunden' })
  }
})

// DELETE /api/wiki/pages/:id – Seite löschen (Kinder werden via Cascade mitgelöscht)
router.delete('/pages/:id', authenticate, requirePermission('wiki:delete'), async (req, res) => {
  try {
    await prisma.wikiPage.delete({ where: { id: req.params.id as string } })
    res.status(204).send()
  } catch {
    res.status(404).json({ message: 'Seite nicht gefunden' })
  }
})

export default router
