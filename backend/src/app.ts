import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env'
import apiRouter from './routes/index'
import { activityLogMiddleware } from './middleware/activity-log'
import { apiRateLimiter } from './middleware/rate-limit'

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors({ origin: env.corsOrigin, credentials: true }))

  // Fallback für Visu-Proxy: Wenn der Interceptor fehlschlägt und /socket.io/
  // direkt am Root ankommt (statt am proxy-path), lesen wir den Referer und
  // leiten intern zum richtigen Device weiter. So funktioniert die Visu auch
  // wenn Client-seitige URL-Rewrites nicht greifen.
  app.use((req, res, next) => {
    if (!req.url.startsWith('/socket.io/')) return next()
    const referer = req.headers.referer ?? ''
    const m = referer.match(/\/api\/vpn\/devices\/([^/?#]+)\/visu/)
    if (!m) return next()
    const deviceId = m[1]
    const newPath = `/api/vpn/devices/${deviceId}/visu${req.url}`
    console.log(`[VisuProxy] Root /socket.io/ fallback → ${newPath}`)
    req.url = newPath
    next()
  })

  // Body-Parser für alle Routen AUSSER Visu-Proxy
  // (Socket.IO Polling POST braucht den rohen Body-Stream für req.pipe())
  app.use((req, res, next) => {
    if (req.path.match(/\/api\/vpn\/devices\/[^/]+\/(visu|lan)\//)) return next()
    express.json()(req, res, next)
  })

  // Activity-Log Middleware – erfasst alle POST/PATCH/PUT/DELETE Requests.
  // Läuft nach Auth, damit req.user verfügbar ist (Auth-Middleware wird in
  // einzelnen Router-Handlern angewendet; finish-Listener feuert auch hier ohne Auth).
  // Generischer Rate-Limiter (600 req/min/IP) – greift vor allen /api/* Routes.
  // Verhindert DoS/Scripted-Scanning und deckt CodeQL's "missing rate limiting"
  // für alle Routen global ab (einzelne Routes haben zusätzliche, striktere Limits).
  app.use('/api', apiRateLimiter)

  app.use('/api', activityLogMiddleware)

  app.use('/api', apiRouter)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ message: 'Route nicht gefunden' })
  })

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err)
    res.status(500).json({ message: 'Interner Serverfehler' })
  })

  return app
}
