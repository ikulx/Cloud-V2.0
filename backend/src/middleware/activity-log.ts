import type { Request, Response, NextFunction } from 'express'
import { logActivity } from '../services/activity-log.service'

/**
 * Logt alle mutierenden HTTP-Requests (POST/PATCH/PUT/DELETE) in die ActivityLog-Tabelle.
 * Liest die Entity-Info aus dem URL-Pfad ab (z.B. /api/anlagen/:id → entityType=anlagen, entityId=:id).
 * GET-Requests werden nicht geloggt (zu viel Noise).
 *
 * Der Eintrag wird nach Response-Ende asynchron geschrieben, sodass ein Audit-Fehler
 * die Antwort nicht beeinflussen kann.
 */
export function activityLogMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next()
  }

  // Pfad-Segmente extrahieren: /api/<entityType>[/<id>][/subresource[/<id2>]]
  res.on('finish', () => {
    // Nur erfolgreiche/relevante Requests loggen (2xx, 3xx, 4xx – 5xx ist schon in console)
    const statusCode = res.statusCode
    if (statusCode >= 500) return

    const pathParts = (req.path || '').split('/').filter(Boolean)
    // pathParts z.B. ['api', 'anlagen', '<uuid>'] oder ['api', 'anlagen', '<uuid>', 'todos']
    const apiIdx = pathParts.indexOf('api')
    const relevant = apiIdx >= 0 ? pathParts.slice(apiIdx + 1) : pathParts

    let entityType: string | null = relevant[0] ?? null
    let entityId: string | null = null
    if (relevant.length >= 2 && /^[0-9a-f-]{8,}/i.test(relevant[1])) {
      entityId = relevant[1]
    }
    // Bei Sub-Ressourcen wie /anlagen/:id/todos/:todoId
    // entityType wird zu z.B. "anlagen.todos"
    if (relevant.length >= 3 && !/^[0-9a-f-]{8,}/i.test(relevant[2])) {
      entityType = `${relevant[0]}.${relevant[2]}`
      if (relevant.length >= 4 && /^[0-9a-f-]{8,}/i.test(relevant[3])) {
        entityId = relevant[3]
      }
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

    // fire-and-forget
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
