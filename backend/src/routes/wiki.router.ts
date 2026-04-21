import { Router } from 'express'
import { z } from 'zod'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import multer from 'multer'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { buildWikiAccessMap, loadWikiUserCtx } from '../services/wiki-access.service'
import { refreshTranslationsForPage, AUTO_TRANSLATE_TARGETS } from '../services/wiki-translate.service'
import { isDeeplEnabled } from '../services/deepl.service'

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
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> }
  let out = ''

  // TipTap-Textknoten
  if (typeof n.text === 'string') out += n.text

  // Sonderfall drawio-Block: Beschriftungen aus XML extrahieren
  if (n.type === 'drawio' && n.attrs && typeof n.attrs.xml === 'string') {
    const drawText = extractDrawioText(n.attrs.xml)
    if (drawText) out += (out && !out.endsWith(' ') ? ' ' : '') + drawText
  }

  // Sonderfall Datei-Anhang: Dateiname (und ggf. MIME) in den Index
  if (n.type === 'fileAttachment' && n.attrs) {
    const a = n.attrs as Record<string, unknown>
    const name = typeof a.name === 'string' ? a.name : ''
    if (name) out += (out && !out.endsWith(' ') ? ' ' : '') + name
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
  type: z.enum(['FOLDER', 'PAGE']).optional(),
})

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  icon: z.string().max(8).optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  content: z.unknown().optional(),
  sortOrder: z.number().int().optional(),
  type: z.enum(['FOLDER', 'PAGE']).optional(),
})

const permissionSchema = z.object({
  targetType: z.enum(['ROLE', 'GROUP', 'USER']),
  targetId: z.string().uuid(),
  level: z.enum(['VIEW', 'EDIT']),
})
const permissionsPutSchema = z.object({
  entries: z.array(permissionSchema),
})

// GET /api/wiki/tree – leichtgewichtiger Seitenbaum für die Sidebar.
// Ergebnis ist pro Benutzer gefiltert und mit effektiven Rechten angereichert.
router.get('/tree', authenticate, async (req, res) => {
  const ctx = await loadWikiUserCtx(req.user!.userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }

  const pages = await prisma.wikiPage.findMany({
    select: { id: true, title: true, icon: true, parentId: true, sortOrder: true, slug: true, updatedAt: true, type: true },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
  })
  const access = await buildWikiAccessMap(ctx)

  // Sichtbare Seiten = solche mit view-Recht. Ein unsichtbarer Zwischenknoten
  // würde den Baum "zerschneiden"; deshalb lassen wir Eltern mit mind. einem
  // sichtbaren Nachkommen ebenfalls sichtbar (flache Navigation).
  const hasVisibleDescendant = new Set<string>()
  // Parent-Lookup vorberechnen
  const parentOf = new Map<string, string | null>()
  for (const p of pages) parentOf.set(p.id, p.parentId ?? null)
  for (const p of pages) {
    if (access.get(p.id)?.view) {
      let cursor = p.parentId ?? null
      while (cursor) {
        if (hasVisibleDescendant.has(cursor)) break
        hasVisibleDescendant.add(cursor)
        cursor = parentOf.get(cursor) ?? null
      }
    }
  }

  const visible = pages
    .filter((p) => access.get(p.id)?.view || hasVisibleDescendant.has(p.id))
    .map((p) => {
      const a = access.get(p.id) ?? { view: false, edit: false }
      return { ...p, canEdit: a.edit, canView: a.view }
    })
  res.json(visible)
})

// GET /api/wiki/pages/:id[?lang=xx] – einzelne Seite mit Inhalt + Autor-Meta.
// Wenn ?lang= gesetzt ist und != sourceLang, wird die (evtl. manuell
// korrigierte) Übersetzung zurückgeliefert. Fehlt eine Übersetzung, greift
// der Original-Inhalt.
router.get('/pages/:id', authenticate, async (req, res) => {
  const ctx = await loadWikiUserCtx(req.user!.userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }

  const access = await buildWikiAccessMap(ctx)
  const a = access.get(req.params.id as string)
  if (!a?.view) { res.status(403).json({ message: 'Keine Berechtigung' }); return }

  const requestedLang = typeof req.query.lang === 'string' ? req.query.lang.toLowerCase() : null

  const page = await prisma.wikiPage.findUnique({
    where: { id: req.params.id as string },
    include: {
      createdBy: { select: authorSelect },
      updatedBy: { select: authorSelect },
      translations: {
        select: { lang: true, title: true, content: true, isEdited: true, updatedAt: true },
      },
    },
  })
  if (!page) { res.status(404).json({ message: 'Seite nicht gefunden' }); return }

  const availableLangs = [page.sourceLang, ...page.translations.map((t) => t.lang)]
  let activeLang = page.sourceLang
  let viewTitle = page.title
  let viewContent = page.content
  let translationMeta: { isEdited: boolean } | null = null

  if (requestedLang && requestedLang !== page.sourceLang) {
    const tr = page.translations.find((t) => t.lang === requestedLang)
    if (tr) {
      activeLang = tr.lang
      viewTitle = tr.title
      viewContent = tr.content
      translationMeta = { isEdited: tr.isEdited }
    }
  }

  // translations-Attribut nicht mitsenden (zu groß), dafür kompakte Meta
  const { translations: _omit, ...pageWithoutTr } = page
  void _omit
  res.json({
    ...pageWithoutTr,
    title: viewTitle,
    content: viewContent,
    activeLang,
    availableLangs: Array.from(new Set(availableLangs)),
    translation: translationMeta,
    translatable: isDeeplEnabled(),
    autoTargets: AUTO_TRANSLATE_TARGETS,
    canEdit: a.edit,
  })
})

// POST /api/wiki/pages – neue Seite (oder neuer Ordner via type: 'FOLDER')
router.post('/pages', authenticate, requirePermission('wiki:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const userId = req.user!.userId

  // Wenn ein Parent angegeben ist: der User muss dort Edit-Rechte haben.
  if (parsed.data.parentId) {
    const ctx = await loadWikiUserCtx(userId)
    if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
    const access = await buildWikiAccessMap(ctx)
    if (!access.get(parsed.data.parentId)?.edit) {
      res.status(403).json({ message: 'Keine Berechtigung im Zielordner' })
      return
    }
  }

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
      type: parsed.data.type ?? 'PAGE',
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
  // Wenn Inhalt/Titel bereits bei der Erstellung gesetzt wurden: Übersetzung
  // anstoßen (nicht-blockierend).
  refreshTranslationsForPage(page.id).catch((err) =>
    console.error('[wiki/translate] bg:', err),
  )
  res.status(201).json(page)
})

// PATCH /api/wiki/pages/:id[?lang=xx] – Inhalt/Meta aktualisieren.
// Ohne ?lang (oder lang == sourceLang) wird die Quellseite geändert und die
// Auto-Übersetzung in alle Zielsprachen angestoßen. Mit ?lang != sourceLang
// wird ausschließlich die Übersetzung gepatcht und als isEdited markiert,
// damit sie beim nächsten Save der Quelle nicht überschrieben wird.
router.patch('/pages/:id', authenticate, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const userId = req.user!.userId

  const ctx = await loadWikiUserCtx(userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const access = await buildWikiAccessMap(ctx)
  if (!access.get(req.params.id as string)?.edit) {
    res.status(403).json({ message: 'Keine Berechtigung' })
    return
  }

  // ── Übersetzungs-Pfad: nicht die Seite selbst, sondern eine
  // WikiPageTranslation-Zeile bearbeiten ──────────────────────────────────
  const langParam = typeof req.query.lang === 'string' ? req.query.lang.toLowerCase() : null
  if (langParam) {
    const page = await prisma.wikiPage.findUnique({
      where: { id: req.params.id as string },
      select: { sourceLang: true, title: true },
    })
    if (!page) { res.status(404).json({ message: 'Seite nicht gefunden' }); return }
    if (langParam !== page.sourceLang) {
      const newTitle = parsed.data.title ?? page.title
      const newContent = parsed.data.content
      const searchText = `${newTitle} ${newContent !== undefined ? extractText(newContent) : ''}`.trim()
      const updated = await prisma.wikiPageTranslation.upsert({
        where: { pageId_lang: { pageId: req.params.id as string, lang: langParam } },
        create: {
          pageId: req.params.id as string,
          lang: langParam,
          title: newTitle,
          content: (newContent ?? { type: 'doc', content: [] }) as object,
          searchText,
          isEdited: true,
          updatedById: userId,
        },
        update: {
          ...(parsed.data.title !== undefined && { title: parsed.data.title }),
          ...(newContent !== undefined && { content: newContent as object }),
          searchText,
          isEdited: true,
          updatedById: userId,
        },
      })
      res.json({ translation: updated, canEdit: true })
      return
    }
  }
  // Beim Verschieben: Ziel-Parent braucht ebenfalls Edit-Recht.
  if (parsed.data.parentId) {
    if (!access.get(parsed.data.parentId)?.edit) {
      res.status(403).json({ message: 'Keine Berechtigung im Zielordner' })
      return
    }
  }

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
        ...(parsed.data.type !== undefined && { type: parsed.data.type }),
        ...(searchText !== undefined && { searchText }),
        updatedById: userId,
      },
      include: {
        createdBy: { select: authorSelect },
        updatedBy: { select: authorSelect },
      },
    })

    // Wenn Titel oder Inhalt geändert wurde: Auto-Übersetzung anstoßen –
    // asynchron im Hintergrund, damit die Antwort nicht auf den DeepL-Call
    // warten muss. Der nächste GET liefert dann die aktualisierten
    // Übersetzungen.
    if (parsed.data.title !== undefined || parsed.data.content !== undefined) {
      refreshTranslationsForPage(page.id).catch((err) =>
        console.error('[wiki/translate] bg:', err),
      )
    }

    res.json({ ...page, canEdit: true })
  } catch {
    res.status(404).json({ message: 'Seite nicht gefunden' })
  }
})

// DELETE /api/wiki/pages/:id – Seite löschen (Kinder werden via Cascade mitgelöscht)
router.delete('/pages/:id', authenticate, requirePermission('wiki:delete'), async (req, res) => {
  const ctx = await loadWikiUserCtx(req.user!.userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const access = await buildWikiAccessMap(ctx)
  if (!access.get(req.params.id as string)?.edit) {
    res.status(403).json({ message: 'Keine Berechtigung' })
    return
  }
  try {
    await prisma.wikiPage.delete({ where: { id: req.params.id as string } })
    res.status(204).send()
  } catch {
    res.status(404).json({ message: 'Seite nicht gefunden' })
  }
})

// POST /api/wiki/pages/:id/duplicate – flache Kopie einer Seite im selben
// Elternordner (Unterseiten werden NICHT mitkopiert).
router.post('/pages/:id/duplicate', authenticate, requirePermission('wiki:create'), async (req, res) => {
  const userId = req.user!.userId
  const sourceId = req.params.id as string

  const ctx = await loadWikiUserCtx(userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const access = await buildWikiAccessMap(ctx)
  if (!access.get(sourceId)?.view) {
    res.status(403).json({ message: 'Keine Berechtigung' })
    return
  }

  const src = await prisma.wikiPage.findUnique({ where: { id: sourceId } })
  if (!src) { res.status(404).json({ message: 'Seite nicht gefunden' }); return }

  // In den Zielordner darf eingefügt werden? (oder Wurzel)
  if (src.parentId && !access.get(src.parentId)?.edit) {
    res.status(403).json({ message: 'Keine Berechtigung im Zielordner' })
    return
  }

  const last = await prisma.wikiPage.findFirst({
    where: { parentId: src.parentId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  const newTitle = `Kopie von ${src.title}`
  const slug = await uniqueSlug(newTitle)

  const created = await prisma.wikiPage.create({
    data: {
      title: newTitle,
      icon: src.icon,
      type: src.type,
      parentId: src.parentId,
      content: src.content as object,
      searchText: src.searchText,
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
  res.status(201).json({ ...created, canEdit: true })
})

// GET /api/wiki/pages/:id/permissions – aktuelle Einträge
router.get('/pages/:id/permissions', authenticate, async (req, res) => {
  const ctx = await loadWikiUserCtx(req.user!.userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const access = await buildWikiAccessMap(ctx)
  if (!access.get(req.params.id as string)?.edit) {
    res.status(403).json({ message: 'Keine Berechtigung' })
    return
  }
  const entries = await prisma.wikiPagePermission.findMany({
    where: { pageId: req.params.id as string },
    select: { targetType: true, targetId: true, level: true },
    orderBy: [{ targetType: 'asc' }, { createdAt: 'asc' }],
  })
  res.json(entries)
})

// PUT /api/wiki/pages/:id/permissions – komplette Liste ersetzen
router.put('/pages/:id/permissions', authenticate, async (req, res) => {
  const parsed = permissionsPutSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() })
    return
  }
  const ctx = await loadWikiUserCtx(req.user!.userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const access = await buildWikiAccessMap(ctx)
  if (!access.get(req.params.id as string)?.edit) {
    res.status(403).json({ message: 'Keine Berechtigung' })
    return
  }

  const pageId = req.params.id as string
  // Alte Einträge löschen, neue anlegen – in einer Transaktion.
  await prisma.$transaction([
    prisma.wikiPagePermission.deleteMany({ where: { pageId } }),
    ...parsed.data.entries.map((e) =>
      prisma.wikiPagePermission.create({
        data: { pageId, targetType: e.targetType, targetId: e.targetId, level: e.level },
      }),
    ),
  ])
  res.json({ count: parsed.data.entries.length })
})

// GET /api/wiki/search?q=... – einfache Volltextsuche in Titel + Inhalt,
// gefiltert auf Seiten mit View-Recht
router.get('/search', authenticate, async (req, res) => {
  const ctx = await loadWikiUserCtx(req.user!.userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const q = String(req.query.q ?? '').trim()
  if (q.length < 2) { res.json([]); return }

  const access = await buildWikiAccessMap(ctx)

  const results = await prisma.wikiPage.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { searchText: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, slug: true, title: true, icon: true, parentId: true, searchText: true },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  })

  const lower = q.toLowerCase()
  const excerpts = results
    .filter((r) => access.get(r.id)?.view)
    .slice(0, 20)
    .map((r) => {
      const body = r.searchText ?? ''
      const idx = body.toLowerCase().indexOf(lower)
      let excerpt = ''
      if (idx >= 0) {
        const start = Math.max(0, idx - 40)
        const end = Math.min(body.length, idx + q.length + 40)
        excerpt = (start > 0 ? '… ' : '') + body.slice(start, end) + (end < body.length ? ' …' : '')
      }
      return { id: r.id, slug: r.slug, title: r.title, icon: r.icon, parentId: r.parentId, excerpt }
    })
  res.json(excerpts)
})

// ─── Bild-Upload für den Editor ───────────────────────────────────────────────

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'wiki')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// Blockliste ausführbarer / gefährlicher Dateien. Alles andere ist erlaubt
// (PDFs, Office-Dokumente, Archive, CAD, Code-Dateien etc.).
const FORBIDDEN_EXT = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif', '.vbs', '.js', '.jse',
  '.ws', '.wsf', '.wsh', '.ps1', '.jar', '.sh',
])

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8)
      const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext : ''
      cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`)
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (FORBIDDEN_EXT.has(ext)) {
      cb(new Error('Dateityp nicht erlaubt'))
      return
    }
    cb(null, true)
  },
})

// POST /api/wiki/upload – gibt { url, name, size, mime } zurück.
// Wird sowohl für Bilder im Editor als auch für generische Dateianhänge
// genutzt – unterscheidet der Aufrufer anhand des MIME-Typs.
router.post('/upload', authenticate, requirePermission('wiki:update'), upload.single('file'), (req, res) => {
  if (!req.file) { res.status(400).json({ message: 'Keine Datei' }); return }
  res.status(201).json({
    url: `/uploads/wiki/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
  })
})

// POST /api/wiki/pages/:id/retranslate?lang=xx – erzwingt eine Neu-Übersetzung
// (auch wenn die bestehende isEdited=true ist). Nur Edit-Berechtigte.
router.post('/pages/:id/retranslate', authenticate, async (req, res) => {
  const lang = typeof req.query.lang === 'string' ? req.query.lang.toLowerCase() : null
  if (!lang) { res.status(400).json({ message: 'lang-Parameter erforderlich' }); return }

  const ctx = await loadWikiUserCtx(req.user!.userId)
  if (!ctx) { res.status(401).json({ message: 'Nicht authentifiziert' }); return }
  const access = await buildWikiAccessMap(ctx)
  if (!access.get(req.params.id as string)?.edit) {
    res.status(403).json({ message: 'Keine Berechtigung' })
    return
  }

  // isEdited-Flag entfernen, damit refreshTranslationsForPage die Übersetzung
  // überschreiben darf.
  await prisma.wikiPageTranslation.updateMany({
    where: { pageId: req.params.id as string, lang },
    data: { isEdited: false },
  })
  await refreshTranslationsForPage(req.params.id as string)
  res.json({ ok: true })
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
