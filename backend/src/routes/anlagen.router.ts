import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { buildVisibleAnlagenWhere } from '../lib/access-filter'
import { publishCommand } from '../services/mqtt.service'

const CONTACT_TODO_TITLE = 'Verantwortlichen vervollständigen'

interface ContactFields {
  contactName?: string | null
  contactPhone?: string | null
  contactMobile?: string | null
  contactEmail?: string | null
}

/**
 * Erstellt/aktualisiert/schliesst automatisch ein "Verantwortlichen vervollständigen"-Todo
 * basierend auf dem aktuellen Kontakt-Zustand der Anlage.
 * - Name fehlt ODER keiner von Telefon/Mobil/E-Mail → Todo erstellen (oder Details updaten)
 * - Alles vorhanden → existierendes offenes Todo auf DONE setzen
 */
async function ensureContactTodo(
  anlageId: string,
  userId: string,
  contact: ContactFields,
): Promise<void> {
  try {
    const hasName = !!contact.contactName?.trim()
    const hasContactMethod = !!(
      contact.contactPhone?.trim() ||
      contact.contactMobile?.trim() ||
      contact.contactEmail?.trim()
    )
    const missing: string[] = []
    if (!hasName)          missing.push('Name')
    if (!hasContactMethod) missing.push('Telefon/Mobil/E-Mail')

    const existing = await prisma.anlageTodo.findFirst({
      where: { anlageId, title: CONTACT_TODO_TITLE, status: 'OPEN' },
    })

    if (missing.length === 0) {
      // Kontakt vollständig → offenes Todo schliessen
      if (existing) {
        await prisma.anlageTodo.update({
          where: { id: existing.id },
          data: { status: 'DONE' },
        })
      }
      return
    }

    const details = `Fehlend: ${missing.join(', ')}`
    if (existing) {
      if (existing.details !== details) {
        await prisma.anlageTodo.update({
          where: { id: existing.id },
          data: { details },
        })
      }
    } else {
      await prisma.anlageTodo.create({
        data: {
          anlageId,
          title: CONTACT_TODO_TITLE,
          details,
          status: 'OPEN',
          createdById: userId,
          // Auto-Zuweisung an den speichernden User
          assignedUsers: { create: [{ userId }] },
        },
      })
    }
  } catch (e) {
    console.warn('[Anlagen] ensureContactTodo fehlgeschlagen:', (e as Error).message)
  }
}

/** Schickt `setProjectNumber` an alle ONLINE-Geräte einer Anlage. */
async function pushProjectNumberToDevices(anlageId: string, projectNumber: string | null | undefined) {
  try {
    const anlageDevices = await prisma.anlageDevice.findMany({
      where: { anlageId },
      include: { device: { select: { serialNumber: true, status: true } } },
    })
    const value = projectNumber ?? ''
    for (const ad of anlageDevices) {
      if (ad.device.status === 'ONLINE') {
        publishCommand(ad.device.serialNumber, { action: 'setProjectNumber', value })
      }
    }
  } catch (e) {
    console.warn('[Anlagen] pushProjectNumberToDevices fehlgeschlagen:', (e as Error).message)
  }
}

const router = Router()

const anlageSchema = z.object({
  projectNumber: z.string().max(50).optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  street: z.string().max(200).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  country: z.string().max(100).optional().nullable(),
  contactName: z.string().max(200).optional().nullable(),
  contactPhone: z.string().max(50).optional().nullable(),
  contactMobile: z.string().max(50).optional().nullable(),
  contactEmail: z.string().max(200).optional().nullable(),
  notes: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  hasHeatPump: z.boolean().optional(),
  hasBoiler: z.boolean().optional(),
  offlineMonitoringEnabled: z.boolean().optional(),
  deviceIds: z.array(z.string().uuid()).optional(),
  userIds: z.array(z.string().uuid()).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
  erzeuger: z.array(z.object({
    typeId: z.string().uuid(),
    serialNumber: z.string().max(100).optional().nullable(),
  })).optional(),
})

const photoUrlsSchema = z.array(z.string().max(500)).optional()
const todoSchema = z.object({
  title: z.string().min(1),
  details: z.string().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  assignedUserIds: z.array(z.string().uuid()).optional(),
  assignedGroupIds: z.array(z.string().uuid()).optional(),
  photoUrls: photoUrlsSchema,
})
const todoUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  details: z.string().optional().nullable(),
  status: z.enum(['OPEN', 'DONE']).optional(),
  dueDate: z.string().datetime().optional().nullable(),
  assignedUserIds: z.array(z.string().uuid()).optional(),
  assignedGroupIds: z.array(z.string().uuid()).optional(),
  photoUrls: photoUrlsSchema,
})

const todoInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  assignedUsers: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
  assignedGroups: { include: { group: { select: { id: true, name: true } } } },
} as const
const logSchema = z.object({ message: z.string().min(1), photoUrls: photoUrlsSchema })

const anlageInclude = {
  anlageDevices: { include: { device: { select: { id: true, name: true, status: true, isApproved: true } } } },
  directUsers: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
  groupAnlagen: { include: { group: { select: { id: true, name: true } } } },
  erzeuger: {
    include: { type: { select: { id: true, name: true, sortOrder: true, isActive: true } } },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  _count: {
    select: {
      anlageDevices: true,
      // Nur OFFENE Todos zählen (für Status-Anzeige in der Übersicht)
      todos: { where: { status: 'OPEN' as const } },
    },
  },
}

/** Validiert die Erzeuger-Liste: Typ muss existieren. Die Seriennummer-
 *  Pflicht wird NICHT mehr abgelehnt – statt dessen erzeugt der Save-Handler
 *  nachträglich automatische Todos für fehlende SN (siehe
 *  ensureSerialNumberTodos). */
async function validateErzeuger(
  erzeuger: { typeId: string; serialNumber?: string | null }[] | undefined,
): Promise<string | null> {
  if (!erzeuger || erzeuger.length === 0) return null
  const typeIds = [...new Set(erzeuger.map((e) => e.typeId))]
  const types = await prisma.erzeugerType.findMany({
    where: { id: { in: typeIds } },
    select: { id: true, name: true },
  })
  for (const entry of erzeuger) {
    const t = types.find((x) => x.id === entry.typeId)
    if (!t) return `Erzeuger-Typ nicht gefunden: ${entry.typeId}`
  }
  return null
}

/** Erzeugt für jeden Erzeuger ohne Seriennummer – sofern der Typ
 *  serialRequired=true hat – ein OPEN-Todo. Bestehende, noch offene Todos
 *  mit derselben (anlageId, erzeugerId)-Kombination werden NICHT dupliziert.
 *  Der Aufrufer liefert die neuen Erzeuger-Zeilen inkl. id aus der DB. */
async function ensureSerialNumberTodos(
  anlageId: string,
  userId: string,
  erzeuger: { id: string; typeId: string; serialNumber: string | null }[],
): Promise<number> {
  if (erzeuger.length === 0) return 0
  const typeIds = [...new Set(erzeuger.map((e) => e.typeId))]
  const types = await prisma.erzeugerType.findMany({
    where: { id: { in: typeIds } },
    select: { id: true, name: true, serialRequired: true },
  })
  const missing = erzeuger.filter((e) => {
    const t = types.find((x) => x.id === e.typeId)
    return t?.serialRequired && !(e.serialNumber?.trim())
  })
  if (missing.length === 0) return 0

  let created = 0
  for (const m of missing) {
    const t = types.find((x) => x.id === m.typeId)
    const titleMarker = `[SN:${m.id}]`
    // Schon offenes Todo für genau diesen Erzeuger? → nicht duplizieren
    const existing = await prisma.anlageTodo.findFirst({
      where: {
        anlageId,
        status: 'OPEN',
        title: { contains: titleMarker },
      },
      select: { id: true },
    })
    if (existing) continue
    await prisma.anlageTodo.create({
      data: {
        anlageId,
        title: `Seriennummer ergänzen: ${t?.name ?? 'Erzeuger'} ${titleMarker}`,
        details: `Die Seriennummer für diesen Erzeuger wurde beim Speichern nicht erfasst. Bitte ergänzen, sobald bekannt.`,
        createdById: userId,
        // Auto-Zuweisung an den speichernden User (sonst hätten wir ein Todo
        // ohne Zuweisung, was wir neu unterbinden).
        assignedUsers: { create: [{ userId }] },
      },
    })
    created++
  }
  return created
}

// GET /api/anlagen
router.get('/', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const where = buildVisibleAnlagenWhere(req.user!)
  const anlagen = await prisma.anlage.findMany({ where, include: anlageInclude, orderBy: { name: 'asc' } })
  res.json(anlagen)
})

// GET /api/anlagen/:id
router.get('/:id', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const where = buildVisibleAnlagenWhere(req.user!)
  const anlage = await prisma.anlage.findFirst({
    where: { id: req.params.id as string as string, ...where },
    include: {
      ...anlageInclude,
      todos: { include: todoInclude, orderBy: { createdAt: 'desc' } },
      logEntries: { include: { createdBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!anlage) { res.status(404).json({ message: 'Anlage nicht gefunden' }); return }
  res.json(anlage)
})

// POST /api/anlagen
router.post('/', authenticate, requirePermission('anlagen:create'), async (req, res) => {
  const parsed = anlageSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const { deviceIds, userIds, groupIds, erzeuger, ...data } = parsed.data

  const erzeugerErr = await validateErzeuger(erzeuger)
  if (erzeugerErr) { res.status(400).json({ message: erzeugerErr }); return }

  const anlage = await prisma.anlage.create({
    data: {
      ...data,
      anlageDevices: deviceIds ? { create: deviceIds.map((deviceId) => ({ deviceId })) } : undefined,
      directUsers: userIds ? { create: userIds.map((userId) => ({ userId })) } : undefined,
      groupAnlagen: groupIds ? { create: groupIds.map((groupId) => ({ groupId })) } : undefined,
      erzeuger: erzeuger ? {
        create: erzeuger.map((e, i) => ({
          typeId: e.typeId,
          serialNumber: e.serialNumber?.trim() || null,
          sortOrder: i * 10,
        })),
      } : undefined,
    },
    include: anlageInclude,
  })

  // Projektnummer an alle zugewiesenen Pi's schreiben (SYS01_DB_Projektnummer)
  if (deviceIds && deviceIds.length > 0) {
    pushProjectNumberToDevices(anlage.id, anlage.projectNumber).catch(() => {})
  }

  // Für jeden Erzeuger ohne Seriennummer (wo der Typ SN-Pflicht hat):
  // automatisch ein OPEN-Todo anlegen.
  if (req.user) {
    await ensureSerialNumberTodos(anlage.id, req.user.userId, anlage.erzeuger ?? [])
  }

  // Kontakt-Todo automatisch erstellen falls Verantwortlicher fehlt/unvollständig
  if (req.user) {
    ensureContactTodo(anlage.id, req.user.userId, {
      contactName: anlage.contactName,
      contactPhone: anlage.contactPhone,
      contactMobile: anlage.contactMobile,
      contactEmail: anlage.contactEmail,
    }).catch(() => {})
  }

  res.status(201).json(anlage)
})

// PATCH /api/anlagen/:id
router.patch('/:id', authenticate, requirePermission('anlagen:update'), async (req, res) => {
  const parsed = anlageSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  const anlageId = req.params.id as string

  // Vorher speichern um Änderungen an projectNumber / deviceIds zu erkennen
  const before = await prisma.anlage.findUnique({
    where: { id: anlageId },
    select: { projectNumber: true },
  })

  const { deviceIds, userIds, groupIds, erzeuger, ...data } = parsed.data

  const erzeugerErr = await validateErzeuger(erzeuger)
  if (erzeugerErr) { res.status(400).json({ message: erzeugerErr }); return }

  const anlage = await prisma.anlage.update({
    where: { id: anlageId },
    data: {
      ...data,
      ...(deviceIds !== undefined && {
        anlageDevices: { deleteMany: {}, create: deviceIds.map((deviceId) => ({ deviceId })) },
      }),
      ...(userIds !== undefined && {
        directUsers: { deleteMany: {}, create: userIds.map((userId) => ({ userId })) },
      }),
      ...(groupIds !== undefined && {
        groupAnlagen: { deleteMany: {}, create: groupIds.map((groupId) => ({ groupId })) },
      }),
      ...(erzeuger !== undefined && {
        erzeuger: {
          deleteMany: {},
          create: erzeuger.map((e, i) => ({
            typeId: e.typeId,
            serialNumber: e.serialNumber?.trim() || null,
            sortOrder: i * 10,
          })),
        },
      }),
    },
    include: anlageInclude,
  })

  // Erzeuger wurden ersetzt → neue SN-Todos prüfen. Alte, jetzt nicht mehr
  // relevante SN-Todos lassen wir stehen (der Marker im Titel enthält die
  // alte Erzeuger-ID, die existiert nicht mehr – User kann sie abhaken).
  if (erzeuger !== undefined && req.user) {
    await ensureSerialNumberTodos(anlage.id, req.user.userId, anlage.erzeuger ?? [])
  }

  // Projektnummer geändert ODER Device-Zuweisung geändert → an alle Geräte pushen
  const projectNumberChanged = parsed.data.projectNumber !== undefined
    && parsed.data.projectNumber !== before?.projectNumber
  if (projectNumberChanged || deviceIds !== undefined) {
    pushProjectNumberToDevices(anlage.id, anlage.projectNumber).catch(() => {})
  }

  // Kontakt-Todo: bei jeder Anlage-Update neu prüfen (öffnen/schliessen/aktualisieren)
  if (req.user) {
    ensureContactTodo(anlage.id, req.user.userId, {
      contactName: anlage.contactName,
      contactPhone: anlage.contactPhone,
      contactMobile: anlage.contactMobile,
      contactEmail: anlage.contactEmail,
    }).catch(() => {})
  }

  res.json(anlage)
})

// DELETE /api/anlagen/:id
router.delete('/:id', authenticate, requirePermission('anlagen:delete'), async (req, res) => {
  await prisma.anlage.delete({ where: { id: req.params.id as string } })
  res.status(204).send()
})

// POST /api/anlagen/:id/todos
router.post('/:id/todos', authenticate, requirePermission('todos:create'), async (req, res) => {
  const parsed = todoSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }
  const { assignedUserIds, assignedGroupIds, dueDate, photoUrls, ...base } = parsed.data
  if ((assignedUserIds?.length ?? 0) === 0 && (assignedGroupIds?.length ?? 0) === 0) {
    res.status(400).json({ message: 'Mindestens ein Benutzer oder eine Gruppe muss zugewiesen werden.' })
    return
  }
  const [todo] = await prisma.$transaction([
    prisma.anlageTodo.create({
      data: {
        anlageId: req.params.id as string,
        ...base,
        dueDate: dueDate ? new Date(dueDate) : null,
        photoUrls: photoUrls ?? [],
        createdById: req.user!.userId,
        assignedUsers: assignedUserIds?.length
          ? { create: assignedUserIds.map((userId) => ({ userId })) } : undefined,
        assignedGroups: assignedGroupIds?.length
          ? { create: assignedGroupIds.map((groupId) => ({ groupId })) } : undefined,
      },
      include: todoInclude,
    }),
    prisma.anlageLogEntry.create({
      data: {
        anlageId: req.params.id as string,
        message: `Todo erstellt: "${base.title}"`,
        createdById: req.user!.userId,
      },
    }),
  ])
  res.status(201).json(todo)
})

// PATCH /api/anlagen/:id/todos/:todoId
router.patch('/:id/todos/:todoId', authenticate, requirePermission('todos:update'), async (req, res) => {
  const parsed = todoUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe', errors: parsed.error.flatten() }); return }

  // Wenn Zuweisungen explizit mitgegeben werden, prüfen dass mind. eine bleibt
  if (parsed.data.assignedUserIds !== undefined || parsed.data.assignedGroupIds !== undefined) {
    // Aktuelle Zuweisungen laden, um den "finalen" Zustand zu prüfen
    const current = await prisma.anlageTodo.findUnique({
      where: { id: req.params.todoId as string },
      include: {
        assignedUsers: { select: { userId: true } },
        assignedGroups: { select: { groupId: true } },
      },
    })
    const newUserIds = parsed.data.assignedUserIds ?? current?.assignedUsers.map((u) => u.userId) ?? []
    const newGroupIds = parsed.data.assignedGroupIds ?? current?.assignedGroups.map((g) => g.groupId) ?? []
    if (newUserIds.length === 0 && newGroupIds.length === 0) {
      res.status(400).json({ message: 'Mindestens ein Benutzer oder eine Gruppe muss zugewiesen bleiben.' })
      return
    }
  }

  const existing = await prisma.anlageTodo.findUnique({ where: { id: req.params.todoId as string }, select: { title: true, status: true } })
  const statusChanged = parsed.data.status && parsed.data.status !== existing?.status
  const logMessage = statusChanged
    ? (parsed.data.status === 'DONE' ? `Todo abgehakt: "${existing?.title}"` : `Todo wieder geöffnet: "${existing?.title}"`)
    : `Todo aktualisiert: "${existing?.title}"`

  const { assignedUserIds, assignedGroupIds, dueDate, photoUrls, ...base } = parsed.data

  const [todo] = await prisma.$transaction([
    prisma.anlageTodo.update({
      where: { id: req.params.todoId as string, anlageId: req.params.id as string },
      data: {
        ...base,
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(photoUrls !== undefined && { photoUrls }),
        ...(assignedUserIds !== undefined && {
          assignedUsers: { deleteMany: {}, create: assignedUserIds.map((userId) => ({ userId })) },
        }),
        ...(assignedGroupIds !== undefined && {
          assignedGroups: { deleteMany: {}, create: assignedGroupIds.map((groupId) => ({ groupId })) },
        }),
      },
      include: todoInclude,
    }),
    prisma.anlageLogEntry.create({
      data: { anlageId: req.params.id as string, message: logMessage, createdById: req.user!.userId },
    }),
  ])
  res.json(todo)
})

// POST /api/anlagen/:id/logs
router.post('/:id/logs', authenticate, requirePermission('logbook:create'), async (req, res) => {
  const parsed = logSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const log = await prisma.anlageLogEntry.create({
    data: {
      anlageId: req.params.id as string,
      message: parsed.data.message,
      photoUrls: parsed.data.photoUrls ?? [],
      createdById: req.user!.userId,
    },
    include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
  })
  res.status(201).json(log)
})

// GET /api/anlagen/:id/photos – alle Fotos aus Todos und Logs der Anlage,
// flach, mit Caption (= Titel des Todos bzw. Message des Logs).
router.get('/:id/photos', authenticate, requirePermission('anlagen:read'), async (req, res) => {
  const anlageId = req.params.id as string
  const [todos, logs] = await Promise.all([
    prisma.anlageTodo.findMany({
      where: { anlageId, photoUrls: { isEmpty: false } },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.anlageLogEntry.findMany({
      where: { anlageId, photoUrls: { isEmpty: false } },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])
  const out: Array<{
    url: string
    caption: string
    source: 'todo' | 'log'
    sourceId: string
    createdAt: Date
    createdBy: { id: string; firstName: string; lastName: string }
  }> = []
  for (const t of todos) {
    for (const url of t.photoUrls) {
      out.push({ url, caption: t.title, source: 'todo', sourceId: t.id, createdAt: t.createdAt, createdBy: t.createdBy })
    }
  }
  for (const l of logs) {
    for (const url of l.photoUrls) {
      out.push({ url, caption: l.message, source: 'log', sourceId: l.id, createdAt: l.createdAt, createdBy: l.createdBy })
    }
  }
  out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  res.json(out)
})

export default router
