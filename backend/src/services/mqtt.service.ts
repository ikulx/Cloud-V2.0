import mqtt from 'mqtt'
import { Server as SocketServer } from 'socket.io'
import { prisma } from '../db/prisma'
import { env } from '../config/env'


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

  if (Object.keys(update).length > 0) {
    await prisma.device.update({ where: { id: device.id }, data: update })
    console.log(`[MQTT] Tele ${serial}:`, update)
    // Frontend informieren
    io.to(`device:${device.id}`).emit('device:tele', { deviceId: device.id, ...update })
  }
}

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

export async function kickMqttClient(serial: string): Promise<void> {
  try {
    const res = await fetch(`${env.emqx.apiUrl}/api/v5/clients/${encodeURIComponent(serial)}`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${env.emqx.apiUser}:${env.emqx.apiPassword}`).toString('base64'),
      },
      signal: AbortSignal.timeout(3000),
    })
    if (res.ok || res.status === 404) {
      console.log(`[MQTT] Client "${serial}" getrennt (Freigabe entzogen)`)
    } else {
      console.warn(`[MQTT] Kick fehlgeschlagen für "${serial}": ${res.status}`)
    }
  } catch (err) {
    console.warn(`[MQTT] Kick-Fehler für "${serial}":`, err)
  }
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
