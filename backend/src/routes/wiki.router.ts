import { Router } from 'express'
import { z } from 'zod'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import multer from 'multer'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

/** Extrahiert die Beschriftungen aller Shapes aus einem drawio-XML.
 *  Nutzt Regex (kein XML-Parser nötig, das Format ist sehr flach – alle
 *  Beschriftungen stecken in `value="…"` Attributen von mxCell-Elementen). */
function extractDrawioText(xml: string): string {
  if (!xml || typeof xml !== 'string') return ''
  const tokens: string[] = []
  // value="…" aus mxCell — value kann HTML enthalten (Rich-Text-Labels).
  const re = /value="((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1] ?? ''
    if (!raw) continue
    const decoded = raw
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
    // HTML-Tags entfernen (Rich-Text-Labels wie <div>…</div>)
    const text = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text) tokens.push(text)
  }
  return tokens.join(' ')
}

/** Extrahiert reinen Text aus einem TipTap-Dokument. Wird für die
 *  Volltextsuche in die Spalte `searchText` gespeichert.
 *  Spezielle Block-Typen (drawio-Diagramme) werden zusätzlich ausgelesen. */
function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { xml?: unknown } }
  let out = ''

  // TipTap-Textknoten
  if (typeof n.text === 'string') out += n.text

  // Sonderfall drawio-Block: Beschriftungen aus XML extrahieren
  if (n.type === 'drawio' && n.attrs && typeof n.attrs.xml === 'string') {
    const drawText = extractDrawioText(n.attrs.xml)
    if (drawText) out += (out && !out.endsWith(' ') ? ' ' : '') + drawText
  }

  if (Array.isArray(n.content)) {
    for (const c of n.content) {
      const sub = extractText(c)
      if (sub) out += (out && !out.endsWith(' ') ? ' ' : '') + sub
    }
  }
  return out
}

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
  const contentJson = (parsed.data.content ?? { type: 'doc', content: [] }) as object

  const page = await prisma.wikiPage.create({
    data: {
      title: parsed.data.title,
      icon: parsed.data.icon ?? null,
      parentId: parsed.data.parentId ?? null,
      content: contentJson,
      searchText: `${parsed.data.title} ${extractText(contentJson)}`.trim(),
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
    // Wenn Titel ODER Content geändert wurde → searchText neu berechnen.
    // Wir brauchen dafür die jeweils "andere" Seite des Pärchens.
    let searchText: string | undefined
    if (parsed.data.title !== undefined || parsed.data.content !== undefined) {
      const existing = await prisma.wikiPage.findUnique({
        where: { id: req.params.id as string },
        select: { title: true, content: true },
      })
      if (existing) {
        const newTitle = parsed.data.title ?? existing.title
        const newContent = parsed.data.content ?? existing.content
        searchText = `${newTitle} ${extractText(newContent)}`.trim()
      }
    }

    const page = await prisma.wikiPage.update({
      where: { id: req.params.id as string },
      data: {
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.icon !== undefined && { icon: parsed.data.icon }),
        ...(parsed.data.parentId !== undefined && { parentId: parsed.data.parentId }),
        ...(parsed.data.content !== undefined && { content: parsed.data.content as object }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
        ...(searchText !== undefined && { searchText }),
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

// GET /api/wiki/search?q=... – einfache Volltextsuche in Titel + Inhalt
router.get('/search', authenticate, requirePermission('wiki:read'), async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) { res.json([]); return }

  const results = await prisma.wikiPage.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { searchText: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, slug: true, title: true, icon: true, parentId: true, searchText: true },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  })

  // Kurzen Textauszug um den Treffer herum erzeugen
  const lower = q.toLowerCase()
  const excerpts = results.map((r) => {
    const body = r.searchText ?? ''
    const idx = body.toLowerCase().indexOf(lower)
    let excerpt = ''
    if (idx >= 0) {
      const start = Math.max(0, idx - 40)
      const end = Math.min(body.length, idx + q.length + 40)
      excerpt = (start > 0 ? '… ' : '') + body.slice(start, end) + (end < body.length ? ' …' : '')
    }
    return {
      id: r.id, slug: r.slug, title: r.title, icon: r.icon, parentId: r.parentId, excerpt,
    }
  })
  res.json(excerpts)
})

// ─── Bild-Upload für den Editor ───────────────────────────────────────────────

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'wiki')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8)
      const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext : ''
      cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(file.mimetype)
    if (ok) cb(null, true)
    else cb(new Error('Nur Bilddateien erlaubt'))
  },
})

// POST /api/wiki/upload – gibt { url } zurück, vom Editor konsumiert
router.post('/upload', authenticate, requirePermission('wiki:update'), upload.single('file'), (req, res) => {
  if (!req.file) { res.status(400).json({ message: 'Keine Datei' }); return }
  res.status(201).json({ url: `/uploads/wiki/${req.file.filename}` })
})

// POST /api/wiki/reindex – alle Seiten erneut in den searchText extrahieren.
// Sinnvoll wenn extractText geändert wurde (z.B. drawio-Support ergänzt) und
// alte Seiten noch den alten Index haben.
router.post('/reindex', authenticate, requirePermission('wiki:update'), async (_req, res) => {
  const pages = await prisma.wikiPage.findMany({
    select: { id: true, title: true, content: true },
  })
  let count = 0
  for (const p of pages) {
    const newSearchText = `${p.title} ${extractText(p.content)}`.trim()
    await prisma.wikiPage.update({
      where: { id: p.id },
      data: { searchText: newSearchText },
    })
    count++
  }
  res.json({ reindexed: count })
})

export default router
