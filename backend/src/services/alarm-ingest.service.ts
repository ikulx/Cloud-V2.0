import { Server as SocketServer } from 'socket.io'
import { prisma } from '../db/prisma'
import { dispatchAlarmEvent } from './alarm-dispatcher.service'

/**
 * Alarm-Ingest
 * ────────────
 * Nimmt MQTT-Nachrichten vom Pi entgegen und legt AlarmEvents in der DB an.
 *
 * Erwartetes Topic-Schema:  yc/<serial>/alarm
 * Erwartetes Payload-Format (JSON):
 *   {
 *     "alarmKey": "wp_stoerung_sensor_t1",
 *     "priority": "PRIO1" | "PRIO2" | "PRIO3" | "WARNING" | "INFO",
 *     "message":  "Wärmepumpe Störung Sensor T1",
 *     "source":   "modbusgateway/data/wp_status",   // optional
 *     "state":    "active" | "cleared",             // default "active"
 *     "timestamp":"2026-04-21T10:30:00.000Z",       // optional
 *     "raw":      { ... }                           // optional
 *   }
 *
 * Dedup-Regel: pro (deviceId, alarmKey) gibt es zu jeder Zeit höchstens
 * ein AlarmEvent mit status=ACTIVE. Erneute "active"-Meldungen für
 * einen bereits aktiven Alarm werden ignoriert (löst keinen neuen Versand
 * aus). "cleared" markiert das aktive Event als CLEARED.
 */

const VALID_PRIORITIES = new Set(['PRIO1', 'PRIO2', 'PRIO3', 'WARNING', 'INFO'])

interface AlarmPayload {
  alarmKey?: unknown
  priority?: unknown
  message?: unknown
  source?: unknown
  state?: unknown
  timestamp?: unknown
  raw?: unknown
}

export async function handleAlarmMessage(
  serial: string,
  payload: string,
  io: SocketServer,
): Promise<void> {
  let data: AlarmPayload
  try {
    data = JSON.parse(payload)
  } catch {
    console.warn(`[AlarmIngest] ${serial}: Payload ist kein gültiges JSON`)
    return
  }

  const alarmKey = typeof data.alarmKey === 'string' ? data.alarmKey.trim() : ''
  const priority = typeof data.priority === 'string' ? data.priority.toUpperCase() : ''
  const message = typeof data.message === 'string' ? data.message.trim() : ''
  const state = typeof data.state === 'string' ? data.state.toLowerCase() : 'active'
  const source = typeof data.source === 'string' ? data.source : null

  if (!alarmKey || !VALID_PRIORITIES.has(priority) || !message) {
    console.warn(`[AlarmIngest] ${serial}: Ungültiges Payload (key=${alarmKey}, prio=${priority})`)
    return
  }

  const device = await prisma.device.findUnique({
    where: { serialNumber: serial },
    select: { id: true, name: true, anlageDevices: { select: { anlageId: true }, take: 1 } },
  })
  if (!device) {
    console.warn(`[AlarmIngest] Unbekannte Seriennummer "${serial}" – Alarm ignoriert`)
    return
  }

  const anlageId = device.anlageDevices[0]?.anlageId ?? null

  // Gibt es bereits ein aktives Event für diese (device, alarmKey)?
  const existing = await prisma.alarmEvent.findFirst({
    where: { deviceId: device.id, alarmKey, status: 'ACTIVE' },
    orderBy: { activatedAt: 'desc' },
  })

  if (state === 'cleared') {
    if (!existing) {
      console.log(`[AlarmIngest] ${serial}/${alarmKey}: cleared – kein aktives Event, ignoriert`)
      return
    }
    const cleared = await prisma.alarmEvent.update({
      where: { id: existing.id },
      data: { status: 'CLEARED', clearedAt: new Date() },
    })
    console.log(`[AlarmIngest] ${serial}/${alarmKey}: CLEARED`)
    if (anlageId) {
      io.to(`anlage:${anlageId}`).emit('alarm:cleared', { id: cleared.id, deviceId: device.id, alarmKey })
    }
    return
  }

  // state=active: wenn bereits aktiv → nichts tun. Sonst neues Event + Versand.
  if (existing) {
    // Optional: aktualisiere rawPayload für Debugging.
    await prisma.alarmEvent.update({
      where: { id: existing.id },
      data: { rawPayload: data.raw !== undefined ? (data.raw as object) : undefined },
    })
    return
  }

  const event = await prisma.alarmEvent.create({
    data: {
      deviceId: device.id,
      anlageId,
      alarmKey,
      priority: priority as 'PRIO1' | 'PRIO2' | 'PRIO3' | 'WARNING' | 'INFO',
      message,
      source,
      rawPayload: data.raw !== undefined ? (data.raw as object) : undefined,
      status: 'ACTIVE',
    },
  })
  console.log(`[AlarmIngest] ${serial}/${alarmKey}: NEW (${priority}) – ${message}`)

  if (anlageId) {
    io.to(`anlage:${anlageId}`).emit('alarm:new', {
      id: event.id,
      deviceId: device.id,
      alarmKey,
      priority,
      message,
      activatedAt: event.activatedAt,
    })
  }

  // Versand asynchron – Ingest soll nicht warten.
  void dispatchAlarmEvent({ eventId: event.id }).catch((err) => {
    console.error(`[AlarmIngest] Dispatch-Fehler für ${event.id}:`, err)
  })
}
