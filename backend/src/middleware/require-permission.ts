import { Request, Response, NextFunction } from 'express'

export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentifizierung erforderlich' })
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
