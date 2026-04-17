import { Request, Response, NextFunction } from 'express'

/**
 * Admin-Rolle hat IMMER Zugriff auf alles. Andere Rollen brauchen die explizite
 * Permission. So müssen neue Permissions nicht für den Admin nachgetragen werden.
 */
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentifizierung erforderlich' })
      return
    }
    if (req.user.roleName === 'admin') {
      next()
      return
    }
    const hasAll = permissions.every((p) => req.user!.permissions.includes(p))
    if (!hasAll) {
      res.status(403).json({ message: 'Keine Berechtigung' })
      return
    }
    next()
  }
}
