import { Request, Response, NextFunction } from 'express'
import { logActivity } from '../services/activity-log.service'

/**
 * System-Rollen (Admin) haben IMMER Zugriff auf alles. Andere Rollen brauchen
 * die explizite Permission. isSystemRole wird nur durch den Seed gesetzt, nicht
 * über die normale Rollen-API — das verhindert Privilege-Escalation durch
 * Erstellen einer Rolle "admin" mit Namen-Match.
 */
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentifizierung erforderlich' })
      return
    }
    if (req.user.isSystemRole) {
      next()
      return
    }
    const hasAll = permissions.every((p) => req.user!.permissions.includes(p))
    if (!hasAll) {
      // 403 loggen – sicherheitsrelevant
      logActivity({
        action: 'permission.denied',
        entityType: 'permission',
        details: { required: permissions, method: req.method, path: req.originalUrl },
        req,
        statusCode: 403,
      }).catch(() => {})
      res.status(403).json({ message: 'Keine Berechtigung' })
      return
    }
    next()
  }
}
