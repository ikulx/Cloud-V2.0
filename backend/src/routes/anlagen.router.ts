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
  deviceIds: z.array(z.string().uuid()).optional(),
  userIds: z.array(z.string().uuid()).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
  erzeuger: z.array(z.object({
    typeId: z.string().uuid(),
    serialNumber: z.string().max(100).optional().nullable(),
  })).optional(),
})

const todoSchema = z.object({ title: z.string().min(1), details: z.string().optional() })
const todoUpdateSchema = z.object({ status: z.enum(['OPEN', 'DONE']) })
const logSchema = z.object({ message: z.string().min(1) })

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

/** Holt das Settings-Flag "Seriennummer obligatorisch" aus SystemSetting. */
async function isSerialRequired(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: 'erzeuger.serialRequired' },
  })
  return (row?.value ?? 'false') === 'true'
}

/** Validiert die Erzeuger-Liste: Typ muss existieren & aktiv sein; wenn
 *  Seriennummer Pflicht ist, muss sie vorhanden sein. */
async function validateErzeuger(
  erzeuger: { typeId: string; serialNumber?: string | null }[] | undefined,
): Promise<string | null> {
  if (!erzeuger || erzeuger.length === 0) return null
  const required = await isSerialRequired()
  const typeIds = [...new Set(erzeuger.map((e) => e.typeId))]
  const types = await prisma.erzeugerType.findMany({
    where: { id: { in: typeIds } },
    select: { id: true, isActive: true, name: true },
  })
  for (const entry of erzeuger) {
    const t = types.find((x) => x.id === entry.typeId)
    if (!t) return `Erzeuger-Typ nicht gefunden: ${entry.typeId}`
    if (required && !(entry.serialNumber?.trim())) {
      return `Seriennummer ist für "${t.name}" obligatorisch.`
    }
  }
  return null
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
      todos: { include: { createdBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } },
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
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const [todo] = await prisma.$transaction([
    prisma.anlageTodo.create({
      data: { anlageId: req.params.id as string, ...parsed.data, createdById: req.user!.userId },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.anlageLogEntry.create({
      data: {
        anlageId: req.params.id as string,
        message: `Todo erstellt: "${parsed.data.title}"`,
        createdById: req.user!.userId,
      },
    }),
  ])
  res.status(201).json(todo)
})

// PATCH /api/anlagen/:id/todos/:todoId
router.patch('/:id/todos/:todoId', authenticate, requirePermission('todos:update'), async (req, res) => {
  const parsed = todoUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }
  const existing = await prisma.anlageTodo.findUnique({ where: { id: req.params.todoId as string }, select: { title: true } })
  const logMessage = parsed.data.status === 'DONE'
    ? `Todo abgehakt: "${existing?.title}"`
    : `Todo wieder geöffnet: "${existing?.title}"`
  const [todo] = await prisma.$transaction([
    prisma.anlageTodo.update({
      where: { id: req.params.todoId as string, anlageId: req.params.id as string },
      data: parsed.data,
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
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
    data: { anlageId: req.params.id as string, ...parsed.data, createdById: req.user!.userId },
    include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
  })
  res.status(201).json(log)
})

export default router
