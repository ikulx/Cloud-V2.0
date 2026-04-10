import './config/env' // load env first
import http from 'http'
import dns from 'dns'
import { execSync } from 'child_process'
import { createApp } from './app'
import { createSocketServer } from './socket/socket-server'
import { initMqttService } from './services/mqtt.service'
import { env } from './config/env'
import { prisma } from './db/prisma'

/** VPN-Route setzen: 10.0.0.0/8 via ycontrol_wireguard
 *  Damit kann der Backend-Container den Pi direkt über den WireGuard-Tunnel erreichen.
 *  Benötigt NET_ADMIN Capability im Docker-Container. */
async function setupVpnRoute() {
  if (env.nodeEnv !== 'production') return
  try {
    const { address: wgIp } = await dns.promises.lookup('ycontrol_wireguard')
    execSync(`ip route replace 10.0.0.0/8 via ${wgIp}`, { stdio: 'pipe' })
    console.log(`✓ VPN-Route 10.0.0.0/8 via ${wgIp} (ycontrol_wireguard) gesetzt`)
  } catch (e: unknown) {
    console.warn('⚠ VPN-Route konnte nicht gesetzt werden:', (e as Error).message,
      '(NET_ADMIN fehlt oder wireguard-Container nicht bereit)')
  }
}

async function main() {
  const app = createApp()
  const httpServer = http.createServer(app)

  const io = createSocketServer(httpServer)
  app.set('io', io)

  await setupVpnRoute()

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
