import './config/env' // load env first
import { validateProdSecrets } from './config/env'
validateProdSecrets()  // exit 1 wenn Prod mit Dev-Secrets läuft
import http from 'http'
import dns from 'dns'
import { createApp } from './app'
import { createSocketServer } from './socket/socket-server'
import { initMqttService } from './services/mqtt.service'
import { startOfflineMonitor } from './services/offline-monitor.service'
import { startActivityLogCleanupScheduler } from './services/activity-log-cleanup.service'
import { env } from './config/env'
import { prisma } from './db/prisma'
import { verifyAccessToken } from './lib/token'
import WebSocket, { WebSocketServer } from 'ws'
import { deriveVpnLanPrefix } from './services/vpn.service'

/** VPN-Route setzen: 10.0.0.0/8 via ycontrol_wireguard
 *  Damit kann der Backend-Container den Pi direkt über den WireGuard-Tunnel erreichen.
 *  Benötigt NET_ADMIN Capability im Docker-Container.
 *  Die IP wird strikt validiert (IPv4-Format), dann via spawnSync ohne Shell übergeben
 *  → kein Command-Injection-Risiko, auch bei kompromittiertem DNS. */
async function setupVpnRoute() {
  if (env.nodeEnv !== 'production') return
  try {
    const { address: wgIp } = await dns.promises.lookup('ycontrol_wireguard')
    // Strikte IPv4-Validierung (verhindert Command-Injection bei manipuliertem DNS)
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(wgIp)) {
      console.warn(`⚠ VPN-Route: DNS lieferte ungültiges IP-Format "${wgIp}", abgebrochen`)
      return
    }
    const { spawnSync } = await import('child_process')
    const result = spawnSync('ip', ['route', 'replace', '10.0.0.0/8', 'via', wgIp], {
      stdio: 'pipe',
    })
    if (result.status === 0) {
      console.log(`✓ VPN-Route 10.0.0.0/8 via ${wgIp} (ycontrol_wireguard) gesetzt`)
    } else {
      console.warn(`⚠ VPN-Route konnte nicht gesetzt werden (exit ${result.status}): ${result.stderr}`)
    }
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

  // ─── WebSocket-Tunnel für Visu-Proxy (Socket.IO) ─────────────────────────────
  // Die Pi-App verbindet Socket.IO im Productionbuild zu aktuellem Origin.
  // Das injizierte Script leitet /socket.io/* zu /api/vpn/devices/:id/visu/socket.io/*
  // um. Hier wird der WS-Upgrade-Request abgefangen und zu Pi weitergeleitet.
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    let match = (req.url ?? '').match(/^\/api\/vpn\/devices\/([^/?]+)\/visu\/socket\.io(.*)/i)
    // Fallback: Wenn WebSocket direkt am Root /socket.io/ ankommt (client-side
    // URL-Rewrite fehlgeschlagen), via Referer das Device ermitteln.
    if (!match && (req.url ?? '').startsWith('/socket.io/')) {
      const referer = (req.headers.referer ?? '') as string
      const m = referer.match(/\/api\/vpn\/devices\/([^/?#]+)\/visu/)
      if (m) {
        const socketPath = (req.url ?? '').replace('/socket.io', '')
        match = ['', m[1], socketPath] as RegExpMatchArray
        console.log(`[WS-Tunnel] Root /socket.io/ fallback via Referer → device ${m[1]}`)
      }
    }
    if (!match) return  // andere Upgrades (z.B. Socket.IO der Cloud-App) nicht anfassen

    const [, deviceId, socketPath] = match

    // Auth via Session-Cookie (Browser sendet Cookie automatisch mit)
    const cookieName = `visu_${deviceId.replace(/-/g, '')}`
    const token = (req.headers.cookie ?? '').split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1)

    if (!token || !verifyAccessToken(token)) {
      try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n') } catch {}
      socket.destroy()
      return
    }

    // Async DB-Abfrage in eigener Funktion mit Error-Handling
    // (damit ein DB-Fehler NICHT als unhandled rejection den Prozess crasht)
    prisma.vpnDevice.findUnique({ where: { deviceId } })
      .then((vpnDevice) => {
        if (!vpnDevice) {
          try { socket.write('HTTP/1.1 404 Not Found\r\n\r\n') } catch {}
          socket.destroy()
          return
        }

        // Visu-IP: wenn visuIp gesetzt → VPN-LAN-Adresse, sonst Fallback auf Pi's VPN-IP
        const visuTargetIp = vpnDevice.visuIp
          ? `${deriveVpnLanPrefix(vpnDevice.vpnIp)}.${vpnDevice.visuIp.split('.').pop()}`
          : vpnDevice.vpnIp
        const piWsUrl = `ws://${visuTargetIp}:${vpnDevice.visuPort}/socket.io${socketPath}`
        console.log(`[WS-Tunnel] ${deviceId} → ${piWsUrl}`)

        const piWs = new WebSocket(piWsUrl, { headers: { host: `${visuTargetIp}:${vpnDevice.visuPort}` } })

        piWs.once('open', () => {
          wss.handleUpgrade(req, socket, head, (clientWs) => {
            clientWs.on('message', (data, isBinary) => {
              if (piWs.readyState === WebSocket.OPEN) piWs.send(data, { binary: isBinary })
            })
            piWs.on('message', (data, isBinary) => {
              if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary })
            })
            clientWs.on('close', (code, reason) => { try { piWs.close(code, reason) } catch {} })
            piWs.on('close', (code, reason) => {
              try { if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason) } catch {}
            })
            clientWs.on('error', () => { try { piWs.terminate() } catch {} })
            piWs.on('error', () => { try { clientWs.terminate() } catch {} })
          })
        })

        piWs.on('error', (err) => {
          console.error('[WS-Tunnel] Fehler bei %s: %s', piWsUrl, err.message)
          try { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n') } catch {}
          socket.destroy()
        })
      })
      .catch((err) => {
        console.error(`[WS-Tunnel] DB-Fehler:`, err.message)
        try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n') } catch {}
        socket.destroy()
      })
  })
  // ─────────────────────────────────────────────────────────────────────────────

  await prisma.$connect()
  console.log('✓ Database connected')

  httpServer.listen(env.port, '0.0.0.0', () => {
    console.log(`✓ Server running on http://0.0.0.0:${env.port}`)
    console.log(`  Environment: ${env.nodeEnv}`)
    initMqttService(io)
    console.log('✓ MQTT service initializing...')
    startActivityLogCleanupScheduler()
    console.log('✓ Activity-Log cleanup scheduler started (daily at 03:00)')
    startOfflineMonitor(io)
    console.log('✓ Offline-Monitor gestartet (5-min-Poll)')
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
