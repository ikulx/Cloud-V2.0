import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../lib/token'
import { getUserAccessContext } from '../services/user-context.service'

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentifizierung erforderlich' })
    return
  }

  const token = authHeader.slice(7)
  const payload = verifyAccessToken(token)
  if (!payload) {
    res.status(401).json({ message: 'Token ungültig oder abgelaufen' })
    return
  }

  const userContext = await getUserAccessContext(payload.sub)
  if (!userContext) {
    res.status(401).json({ message: 'Benutzer nicht gefunden oder deaktiviert' })
    return
  }

  req.user = userContext
  next()
}
