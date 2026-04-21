import type { Request, Response, NextFunction } from 'express'
import {
  logActivity,
  fetchEntitySnapshot,
  computeDiff,
} from '../services/activity-log.service'

/** Nur diese Top-Level-Entitäten werden als entityType akzeptiert. */
const KNOWN_ENTITIES = new Set([
  'anlagen', 'devices', 'users', 'groups', 'roles', 'permissions',
  'vpn', 'settings', 'invitations', 'auth', 'activity-log', 'me',
  'wiki',
])

const KNOWN_SUBRESOURCES = new Set([
  'todos', 'logs', 'peers', 'lan-devices', 'lan-device',
  'todo', 'log', 'deploy', 'approve', 'command', 'enable', 'disable',
  'pi-config', 'server-config', 'device-config', 'visu', 'ping',
  'setup-script', 'invite', 'accept', 'register', 'refresh', 'config',
  // Wiki-Subressourcen: /api/wiki/pages/:id, /api/wiki/pages/:id/duplicate etc.
  'pages', 'tree', 'search', 'upload', 'reindex', 'duplicate', 'retranslate', 'permissions',
])

/** Entitäten für die wir einen Before/After-Diff machen. */
const DIFFABLE_ENTITIES = new Set(['anlagen', 'devices', 'users', 'groups', 'roles', 'wiki'])

/**
 * Pfade die NIE geloggt werden (interne System-Flows, Health-Checks, Pi-Callbacks).
 * Match erfolgt mit startsWith (lowercase).
 */
const SILENCED_PATHS = [
  '/api/devices/register',        // Pi-Selbstregistrierung (alle 30 Min)
  '/api/vpn/device-config',       // Pi pulled seine eigene VPN-Config
  '/api/auth/refresh',            // Automatischer Token-Refresh alle paar Minuten
  '/api/me',                      // Me-Request beim Seiten-Load
  '/health',                      // Health-Check
]

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

interface PathInfo {
  entityType: string | null
  entityId: string | null
  isSubResource: boolean
}

function parsePath(originalUrl: string): PathInfo {
  const fullPath = (originalUrl || '').split('?')[0]
  const parts = fullPath.split('/').filter(Boolean)
  const relevant = parts[0] === 'api' ? parts.slice(1) : parts

  let entityType: string | null = null
  let entityId: string | null = null
  let isSubResource = false

  for (let i = 0; i < relevant.length; i++) {
    const seg = relevant[i]
    if (KNOWN_ENTITIES.has(seg)) {
      entityType = seg
      if (relevant[i + 1] && isUuid(relevant[i + 1])) {
        entityId = relevant[i + 1]
      }
      const afterId = relevant[i + 1] && isUuid(relevant[i + 1]) ? i + 2 : i + 1
      if (relevant[afterId] && KNOWN_SUBRESOURCES.has(relevant[afterId])) {
        entityType = `${entityType}.${relevant[afterId]}`
        isSubResource = true
        if (relevant[afterId + 1] && isUuid(relevant[afterId + 1])) {
          entityId = relevant[afterId + 1]
        }
      }
      break
    }
  }

  if (!entityType && relevant.length > 0) {
    const firstNonUuid = relevant.find((s) => !isUuid(s))
    if (firstNonUuid) entityType = firstNonUuid
  }

  return { entityType, entityId, isSubResource }
}

/**
 * Aktivitäts-Log mit Before/After-Diff.
 * - Vor PATCH/PUT/DELETE: Snapshot der Entität
 * - Nach Response-Ende: neuen Snapshot holen, Diff berechnen
 * - Details enthalten: entityName, changes: { field: {from, to} }
 */
export async function activityLogMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next()
  }

  const { entityType, entityId, isSubResource } = parsePath(req.originalUrl || '')
  const baseEntity = entityType?.split('.')[0] ?? null
  // Wiki-Seiten liegen unter /wiki/pages/:id – parsePath kennzeichnet sie als
  // Subressource, obwohl "pages" in Wahrheit die Haupt-Entität ist. Deshalb
  // diff-fähig machen.
  const isMainResource = !isSubResource || entityType === 'wiki.pages'

  // Before-Snapshot für Updates/Deletes
  let before: { data: Record<string, unknown>; label: string | null } | null = null
  if (
    entityId &&
    baseEntity &&
    DIFFABLE_ENTITIES.has(baseEntity) &&
    isMainResource &&
    (method === 'PATCH' || method === 'PUT' || method === 'DELETE')
  ) {
    before = await fetchEntitySnapshot(baseEntity, entityId)
  }

  res.on('finish', () => {
    const statusCode = res.statusCode
    if (statusCode >= 500) return

    const actionVerb = method === 'POST' ? 'create'
                     : method === 'DELETE' ? 'delete'
                     : 'update'
    const action = `${entityType ?? 'unknown'}.${actionVerb}`
    // Route-Handler können nach Erstellen einer Entität die neue ID in
    // res.locals.createdEntityId stellen, damit das Log den Datensatz auch
    // dann findet, wenn die URL (noch) keine ID enthält (z.B. POST /wiki/pages).
    const resolvedEntityId = entityId ?? (res.locals?.createdEntityId as string | undefined) ?? null

    // Duplikat-Logging für Auth vermeiden (dort explizit)
    if (entityType === 'auth' || action.startsWith('auth.')) return

    // System-/Pi-Aufrufe ohne authentifizierten User werden NICHT geloggt.
    // Das betrifft z.B. Pi-Selbstregistrierung (alle 30 Min) und Pi-VPN-Config-Pull.
    // Wichtige sicherheitsrelevante Events (Login-fail, 403) gehen durch explizite
    // logActivity-Aufrufe, nicht die Middleware.
    if (!req.user) return

    // Explizit ignorierte Pfade (nicht audit-relevant, aber vollständigkeitshalber)
    const lowerPath = (req.originalUrl || '').toLowerCase()
    if (SILENCED_PATHS.some((p) => lowerPath.startsWith(p))) return

    // Sensitive Payload-Felder entfernen
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      const lk = k.toLowerCase()
      if (lk.includes('password') || lk.includes('secret') || lk.includes('token') || lk.includes('privatekey')) continue
      sanitized[k] = v
    }

    const details: Record<string, unknown> = {}
    if (Object.keys(sanitized).length > 0) details.payload = sanitized

    // Async: After-Snapshot für Diff, dann Log schreiben
    void (async () => {
      if (statusCode >= 400) {
        // Fehlerhafte Requests: einfach so loggen mit entityName vom before-Snapshot
        if (before?.label) details.entityName = before.label
        await logActivity({
          action,
          entityType,
          entityId: resolvedEntityId,
          details: Object.keys(details).length > 0 ? details : null,
          req,
          statusCode,
        })
        return
      }

      // Bei erfolgreichen Updates: Diff berechnen
      if (before && resolvedEntityId && baseEntity && DIFFABLE_ENTITIES.has(baseEntity) && (method === 'PATCH' || method === 'PUT')) {
        const after = await fetchEntitySnapshot(baseEntity, resolvedEntityId)
        if (after) {
          const changes = computeDiff(before.data, after.data)
          if (Object.keys(changes).length > 0) {
            details.changes = changes
          }
          details.entityName = after.label ?? before.label
        } else {
          details.entityName = before.label
        }
      } else if (method === 'POST' && resolvedEntityId && baseEntity && DIFFABLE_ENTITIES.has(baseEntity)) {
        // Neu erstellt: aktuellen Snapshot als "created" ablegen
        const snap = await fetchEntitySnapshot(baseEntity, resolvedEntityId)
        if (snap) {
          details.entityName = snap.label
          details.created = extractInterestingFields(snap.data, baseEntity)
        }
      } else if (method === 'DELETE' && before) {
        details.entityName = before.label
      }

      await logActivity({
        action,
        entityType,
        entityId: resolvedEntityId,
        details: Object.keys(details).length > 0 ? details : null,
        req,
        statusCode,
      })
    })()
  })

  next()
}

function extractInterestingFields(data: Record<string, unknown>, entityType: string): Record<string, unknown> {
  const fields = ENTITY_INTERESTING_FIELDS[entityType] ?? ['name']
  const result: Record<string, unknown> = {}
  for (const f of fields) {
    if (data[f] !== undefined && data[f] !== null && data[f] !== '') result[f] = data[f]
  }
  return result
}

const ENTITY_INTERESTING_FIELDS: Record<string, string[]> = {
  anlagen: ['projectNumber', 'name', 'city', 'hasHeatPump', 'hasBoiler'],
  devices: ['serialNumber', 'name', 'ipAddress', 'isApproved'],
  users: ['firstName', 'lastName', 'email', 'roleId'],
  groups: ['name', 'description'],
  roles: ['name', 'description'],
  wiki: ['title', 'type', 'icon', 'parentId'],
}
