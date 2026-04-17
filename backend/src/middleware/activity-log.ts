import type { Request, Response, NextFunction } from 'express'
import { logActivity } from '../services/activity-log.service'

/**
 * Bekannte Top-Level Entitäten. Nur diese werden als entityType akzeptiert.
 * Verhindert dass UUIDs oder andere Path-Segmente als Entity-Name landen.
 */
const KNOWN_ENTITIES = new Set([
  'anlagen', 'devices', 'users', 'groups', 'roles', 'permissions',
  'vpn', 'settings', 'invitations', 'auth', 'activity-log', 'me',
])

/**
 * Bekannte Sub-Ressourcen (für z.B. anlagen/<id>/todos).
 * Wenn ein Segment hier steht, wird es an entityType angehängt.
 */
const KNOWN_SUBRESOURCES = new Set([
  'todos', 'logs', 'peers', 'lan-devices', 'lan-device',
  'todo', 'log', 'deploy', 'approve', 'command', 'enable', 'disable',
  'pi-config', 'server-config', 'device-config', 'visu', 'ping',
  'setup-script', 'invite', 'accept', 'register', 'refresh',
])

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/**
 * Logt alle mutierenden HTTP-Requests (POST/PATCH/PUT/DELETE) in die ActivityLog-Tabelle.
 * - entityType wird nur aus KNOWN_ENTITIES gesetzt (nie UUIDs).
 * - entityId ist die letzte UUID im Pfad (oft die Sub-Entity bei verschachtelten Routen).
 * - Für Sub-Ressourcen wird ".subresource" angehängt.
 * - GET-Requests werden nicht geloggt (zu viel Noise).
 */
export function activityLogMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next()
  }

  res.on('finish', () => {
    const statusCode = res.statusCode
    if (statusCode >= 500) return

    // originalUrl verwenden (z.B. /api/anlagen/<uuid>/todos) – unabhängig vom Mount-Point.
    const fullPath = (req.originalUrl || '').split('?')[0]
    const parts = fullPath.split('/').filter(Boolean)
    // "api"-Prefix entfernen falls vorhanden
    const relevant = parts[0] === 'api' ? parts.slice(1) : parts

    let entityType: string | null = null
    let entityId: string | null = null

    // Erstes bekanntes Entity-Segment suchen
    for (let i = 0; i < relevant.length; i++) {
      const seg = relevant[i]
      if (KNOWN_ENTITIES.has(seg)) {
        entityType = seg
        // Nächstes Segment UUID? → entityId
        if (relevant[i + 1] && isUuid(relevant[i + 1])) {
          entityId = relevant[i + 1]
        }
        // Gibt es danach eine bekannte Sub-Ressource? → anhängen
        const afterId = relevant[i + 1] && isUuid(relevant[i + 1]) ? i + 2 : i + 1
        if (relevant[afterId] && KNOWN_SUBRESOURCES.has(relevant[afterId])) {
          entityType = `${entityType}.${relevant[afterId]}`
          // Danach evtl. Sub-Entity UUID?
          if (relevant[afterId + 1] && isUuid(relevant[afterId + 1])) {
            entityId = relevant[afterId + 1]
          }
        }
        break
      }
    }

    // Fallback: wenn nichts Bekanntes gefunden, den ersten Pfad-Teil nehmen (ohne UUIDs)
    if (!entityType && relevant.length > 0) {
      const firstNonUuid = relevant.find((s) => !isUuid(s))
      if (firstNonUuid) entityType = firstNonUuid
    }

    const actionVerb = method === 'POST' ? 'create'
                     : method === 'DELETE' ? 'delete'
                     : 'update'
    const action = `${entityType ?? 'unknown'}.${actionVerb}`

    // Sensitive Payload-Felder rausfiltern (Passwörter, Secrets)
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}
    const sanitized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body)) {
      const lk = k.toLowerCase()
      if (lk.includes('password') || lk.includes('secret') || lk.includes('token') || lk.includes('privatekey')) continue
      sanitized[k] = v
    }

    // Doppellog für auth.login / auth.login.failed vermeiden (werden im auth.router explizit geloggt)
    if (entityType === 'auth' || action.startsWith('auth.')) return

    logActivity({
      action,
      entityType,
      entityId,
      details: Object.keys(sanitized).length > 0 ? sanitized : null,
      req,
      statusCode,
    }).catch(() => { /* bereits gelogged in service */ })
  })

  next()
}
