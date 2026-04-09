import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { env } from './config/env'
import apiRouter from './routes/index'

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors({ origin: env.corsOrigin, credentials: true }))
  app.use(express.json())

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
