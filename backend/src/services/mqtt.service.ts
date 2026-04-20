import mqtt from 'mqtt'
import { Server as SocketServer } from 'socket.io'
import { prisma } from '../db/prisma'
import { env } from '../config/env'
import { logActivity } from './activity-log.service'


let client: mqtt.MqttClient | null = null

export function initMqttService(io: SocketServer) {
  client = mqtt.connect(env.mqttUrl, {
    clientId: env.mqttBackendUser,
    username: env.mqttBackendUser,
    password: env.mqttBackendPassword,
    clean: true,
    reconnectPeriod: 5000,
  })

  client.on('connect', () => {
    console.log(`[MQTT] Backend verbunden mit ${env.mqttUrl}`)
    client!.subscribe(['yc/+/stat', 'yc/+/tele', 'yc/+/resp'], (err) => {
      if (err) console.error('[MQTT] Subscribe Fehler:', err)
      else console.log('[MQTT] Subscribed: yc/+/stat, yc/+/tele, yc/+/resp')
    })
  })

  client.on('error', (err) => {
    console.error('[MQTT] Verbindungsfehler:', err.message)
  })

  client.on('reconnect', () => {
    console.log('[MQTT] Verbinde neu...')
  })

  client.on('message', async (topic, payload) => {
    // topic format: yc/{serial}/{type}
    const parts = topic.split('/')
    if (parts.length !== 3 || parts[0] !== 'yc') return
    const serial = parts[1]
    const type = parts[2]

    try {
      if (type === 'stat') {
        await handleStat(serial, payload.toString(), io)
      } else if (type === 'tele') {
        await handleTele(serial, payload.toString(), io)
      } else if (type === 'resp') {
        handleResp(serial, payload.toString(), io)
      }
    } catch (err) {
      console.error(`[MQTT] Fehler bei Topic ${topic}:`, err)
    }
  })
}

async function handleStat(serial: string, payload: string, io: SocketServer) {
  const isOnline = payload.trim().toLowerCase() === 'online'
  const status = isOnline ? 'ONLINE' : 'OFFLINE'

  const device = await prisma.device.findUnique({
    where: { serialNumber: serial },
    select: { id: true, status: true },
  })
  if (!device) return

  if (device.status === status) return // keine Änderung

  await prisma.device.update({
    where: { id: device.id },
    data: { status, lastSeen: isOnline ? new Date() : undefined },
  })

  console.log(`[MQTT] ${serial} → ${status}`)

  io.to(`device:${device.id}`).emit('device:status', {
    deviceId: device.id,
    status,
    lastSeen: isOnline ? new Date() : undefined,
  })
}

async function handleTele(serial: string, payload: string, io: SocketServer) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(payload)
  } catch {
    return
  }

  const device = await prisma.device.findUnique({
    where: { serialNumber: serial },
    select: { id: true },
  })
  if (!device) return

  const update: Record<string, unknown> = {}
  if (typeof data.agentVersion === 'string') update.agentVersion = data.agentVersion
  if (typeof data.ipAddress === 'string') update.ipAddress = data.ipAddress
  if (typeof data.firmwareVersion === 'string') update.firmwareVersion = data.firmwareVersion
  if (typeof data.anlageName === 'string' && data.anlageName.trim()) update.name = data.anlageName.trim()
  if (typeof data.projectNumber === 'string' && data.projectNumber.trim()) update.projectNumber = data.projectNumber.trim()
  if (typeof data.schemaNumber === 'string' && data.schemaNumber.trim()) update.schemaNumber = data.schemaNumber.trim()
  if (typeof data.visuVersion === 'string' && data.visuVersion.trim()) update.visuVersion = data.visuVersion.trim()

  if (typeof data.vpnActive === 'boolean') update.vpnActive = data.vpnActive
  if (typeof data.httpActive === 'boolean') update.httpActive = data.httpActive
  if (typeof data.hasRouter === 'boolean') update.hasRouter = data.hasRouter

  if (Object.keys(update).length > 0) {
    await prisma.device.update({ where: { id: device.id }, data: update })
    console.log(`[MQTT] Tele ${serial}:`, update)
    // Frontend informieren
    io.to(`device:${device.id}`).emit('device:tele', { deviceId: device.id, ...update })
  }

  // Router-IPs automatisch in VpnDevice speichern (wenn vorhanden)
  if (typeof data.piLanIp === 'string' || typeof data.piWanIp === 'string') {
    const vpnDevice = await prisma.vpnDevice.findUnique({
      where: { deviceId: device.id },
    })
    if (vpnDevice) {
      const vpnUpdate: Record<string, unknown> = {}
      if (typeof data.piLanIp === 'string' && data.piLanIp !== vpnDevice.visuIp) {
        vpnUpdate.visuIp = data.piLanIp
      }
      if (typeof data.piWanIp === 'string' && data.piWanIp !== vpnDevice.wanIp) {
        vpnUpdate.wanIp = data.piWanIp
      }
      if (Object.keys(vpnUpdate).length > 0) {
        await prisma.vpnDevice.update({ where: { id: vpnDevice.id }, data: vpnUpdate })
        console.log(`[MQTT] VPN-Device ${serial} auto-update:`, vpnUpdate)
      }
    }
  }

  // Projektnummer-Sync: Pi hat aktuelle Projektnummer via Tele gemeldet.
  // Prüfen ob sie mit der zugewiesenen Anlage übereinstimmt, sonst korrigieren.
  try {
    const assignments = await prisma.anlageDevice.findMany({
      where: { deviceId: device.id },
      include: { anlage: { select: { projectNumber: true, name: true } } },
      orderBy: { assignedAt: 'asc' },
      take: 1,
    })
    if (assignments.length > 0) {
      const expected = assignments[0].anlage.projectNumber ?? ''
      const actual = typeof data.projectNumber === 'string' ? data.projectNumber : ''
      if (expected !== actual) {
        console.log(`[MQTT] ${serial}: Projektnummer-Mismatch ('${actual}' → '${expected}'), sende setProjectNumber`)
        publishCommand(serial, { action: 'setProjectNumber', value: expected })

        // Audit-Log NUR schreiben wenn dies ein NEUER Mismatch ist – sonst entsteht
        // bei nicht reagierenden Pis alle 10 Min ein Eintrag. Wir merken uns das
        // zuletzt gesendete Paar (device, expected, actual) und loggen nur einmal
        // pro Kombination innerhalb von 24 h.
        const cacheKey = `${device.id}:${actual}→${expected}`
        const prev = autoSyncLogCache.get(cacheKey)
        const nowMs = Date.now()
        if (!prev || (nowMs - prev) > 24 * 60 * 60 * 1000) {
          autoSyncLogCache.set(cacheKey, nowMs)
          void prisma.device.findUnique({ where: { id: device.id }, select: { name: true } })
            .then((dev) => logActivity({
              action: 'system.projectNumber.autoSync',
              entityType: 'devices',
              entityId: device.id,
              details: {
                entityName: dev?.name?.trim() || serial,
                changes: { projectNumber: { from: actual, to: expected } },
                anlageName: assignments[0].anlage.name,
              },
            }))
            .catch(() => {})
        }
      } else {
        // Kein Mismatch mehr → Cache-Eintrag löschen, damit bei erneutem Drift
        // wieder geloggt wird.
        const prefix = `${device.id}:`
        for (const k of autoSyncLogCache.keys()) {
          if (k.startsWith(prefix)) autoSyncLogCache.delete(k)
        }
      }
    }
  } catch (e) {
    console.warn(`[MQTT] Projektnummer-Check fehlgeschlagen für ${serial}:`, (e as Error).message)
  }
}

/** Cache: welche Projektnummer-Auto-Sync-Kombination wurde zuletzt wann geloggt. */
const autoSyncLogCache = new Map<string, number>()

function handleResp(serial: string, payload: string, io: SocketServer) {
  console.log(`[MQTT] Resp ${serial}: ${payload}`)
  // Broadcast command response to frontend clients in the device room
  try {
    const data = JSON.parse(payload)
    // Forward to any frontend clients subscribed to this device
    io.to(`device:${serial}:cmnd`).emit('device:cmdresp', { serial, ...data })
  } catch {
    io.to(`device:${serial}:cmnd`).emit('device:cmdresp', { serial, raw: payload })
  }
}

export function kickMqttClient(serial: string): void {
  // Mit Mosquitto gibt es keine REST-API zum Trennen von Clients.
  // Retained Messages werden gelöscht und das Gerät verliert beim nächsten
  // Verbindungsversuch die Auth (deviceSecret wurde in DB gelöscht).
  console.log(`[MQTT] Freigabe entzogen für "${serial}" – Retained Messages werden gelöscht`)
  clearRetainedMessages(serial)
}

export function clearRetainedMessages(serial: string): void {
  if (!client?.connected) return
  // Leere retained Message = Retained Message löschen (MQTT-Standard)
  for (const suffix of ['stat', 'tele']) {
    client.publish(`yc/${serial}/${suffix}`, '', { retain: true, qos: 1 })
  }
  console.log(`[MQTT] Retained Messages gelöscht für "${serial}"`)
}

export function publishCommand(serial: string, command: Record<string, unknown>): boolean {
  if (!client?.connected) {
    console.warn(`[MQTT] publishCommand: nicht verbunden`)
    return false
  }
  const topic = `yc/${serial}/cmnd`
  client.publish(topic, JSON.stringify(command))
  console.log(`[MQTT] Command → ${topic}:`, command)
  return true
}
