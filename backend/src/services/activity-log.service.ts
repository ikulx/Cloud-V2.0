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
}

/**
 * Schreibt einen Eintrag ins Activity-Log.
 * Fehler werden nur geloggt, niemals weitergeworfen – Audit soll nie den
 * eigentlichen Request fail'en lassen.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const user = input.req?.user
    await prisma.activityLog.create({
      data: {
        userId: user?.userId ?? null,
        userEmail: user?.email ?? null,
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
