import './config/env' // load env first
import http from 'http'
import { createApp } from './app'
import { createSocketServer } from './socket/socket-server'
import { initMqttService } from './services/mqtt.service'
import { env } from './config/env'
import { prisma } from './db/prisma'

async function main() {
  const app = createApp()
  const httpServer = http.createServer(app)

  const io = createSocketServer(httpServer)
  app.set('io', io)

  await prisma.$connect()
  console.log('✓ Database connected')

  httpServer.listen(env.port, '0.0.0.0', () => {
    console.log(`✓ Server running on http://0.0.0.0:${env.port}`)
    console.log(`  Environment: ${env.nodeEnv}`)
    initMqttService(io)
    console.log('✓ MQTT service initializing...')
  })

  process.on('SIGTERM', async () => {
    await prisma.$disconnect()
    httpServer.close()
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
