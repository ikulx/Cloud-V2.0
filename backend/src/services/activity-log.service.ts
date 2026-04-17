import type { Request } from 'express'
import { prisma } from '../db/prisma'

export interface LogActivityInput {
  action: string
  entityType?: string | null
  entityId?: string | null
  details?: Record<string, unknown> | null
  /** Falls vorhanden, wird daraus method/path/ip/userAgent extrahiert */
  req?: Request
  statusCode?: number | null
  /** Explizit userId/userEmail (überschreibt req.user) – z.B. für System-Events */
  userId?: string | null
  userEmail?: string | null
}

/** Felder die nie in die Log-Details geschrieben werden (Sicherheit + Rauschen). */
const SENSITIVE_FIELDS = new Set([
  'passwordHash', 'password', 'deviceSecret', 'piPrivateKey', 'piPublicKey',
  'tokenHash', 'refreshToken', 'accessToken',
])
const NOISY_FIELDS = new Set(['updatedAt', 'createdAt', 'id'])

/**
 * Schreibt einen Eintrag ins Activity-Log.
 * Fehler werden nur geloggt, niemals weitergeworfen.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const user = input.req?.user
    await prisma.activityLog.create({
      data: {
        userId: input.userId !== undefined ? input.userId : (user?.userId ?? null),
        userEmail: input.userEmail !== undefined ? input.userEmail : (user?.email ?? null),
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        details: (input.details ?? null) as never,
        method: input.req?.method ?? null,
        path: input.req?.originalUrl ?? input.req?.path ?? null,
        statusCode: input.statusCode ?? null,
        ipAddress: input.req ? getIp(input.req) : null,
        userAgent: input.req?.headers['user-agent'] ?? null,
      },
    })
  } catch (e) {
    console.warn('[ActivityLog] Eintrag fehlgeschlagen:', (e as Error).message)
  }
}

function getIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim()
  if (Array.isArray(xff) && xff.length > 0) return xff[0].split(',')[0].trim()
  return req.ip ?? req.socket?.remoteAddress ?? null
}

// ─── Entity-Snapshot & Diff ───────────────────────────────────────────────────

export interface EntitySnapshot {
  data: Record<string, unknown>
  /** Menschenlesbarer Name (z.B. Anlage-Name, Device-Seriennummer) für Log-Titel */
  label: string | null
}

/**
 * Holt den aktuellen Zustand einer Entität + einen sprechenden Namen.
 * Bei unbekanntem entityType gibt es null zurück.
 */
export async function fetchEntitySnapshot(
  entityType: string,
  entityId: string,
): Promise<EntitySnapshot | null> {
  try {
    switch (entityType) {
      case 'anlagen': {
        const e = await prisma.anlage.findUnique({ where: { id: entityId } })
        if (!e) return null
        return { data: e as unknown as Record<string, unknown>, label: e.name }
      }
      case 'devices': {
        const e = await prisma.device.findUnique({
          where: { id: entityId },
          include: {
            anlageDevices: { include: { anlage: { select: { id: true, name: true } } } },
          },
        })
        if (!e) return null
        return {
          data: e as unknown as Record<string, unknown>,
          label: e.name?.trim() || e.serialNumber,
        }
      }
      case 'users': {
        const e = await prisma.user.findUnique({ where: { id: entityId } })
        if (!e) return null
        return {
          data: e as unknown as Record<string, unknown>,
          label: `${e.firstName} ${e.lastName} (${e.email})`,
        }
      }
      case 'groups': {
        const e = await prisma.userGroup.findUnique({ where: { id: entityId } })
        if (!e) return null
        return { data: e as unknown as Record<string, unknown>, label: e.name }
      }
      case 'roles': {
        const e = await prisma.role.findUnique({ where: { id: entityId } })
        if (!e) return null
        return { data: e as unknown as Record<string, unknown>, label: e.name }
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

/** Vergleicht zwei Snapshots und gibt geänderte Felder als { from, to } zurück. */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (SENSITIVE_FIELDS.has(key) || NOISY_FIELDS.has(key)) continue
    if (key.toLowerCase().includes('hash')) continue
    const from = before[key]
    const to = after[key]
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = { from, to }
    }
  }
  return changes
}

/**
 * Entity-Name nachschlagen (nur der Label, ohne kompletten Snapshot).
 * Günstiger als fetchEntitySnapshot wenn nur der Titel gebraucht wird.
 */
export async function fetchEntityLabel(
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const snap = await fetchEntitySnapshot(entityType, entityId)
  return snap?.label ?? null
}
