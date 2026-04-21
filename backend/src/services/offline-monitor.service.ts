import { Server as SocketServer } from 'socket.io'
import { prisma } from '../db/prisma'
import { sendMail } from './mail.service'
import { getSetting } from '../routes/settings.router'

/**
 * Offline-Monitor
 * ───────────────
 * Läuft periodisch (alle 5 min) und prüft:
 *
 *  1. Geräte, die länger als `alarm.offlineThresholdMinutes` Minuten
 *     OFFLINE sind und zu einer Anlage gehören, bei der
 *     `offlineMonitoringEnabled = true` ist, und für die noch kein
 *     aktiver System-Alarm existiert → Alarm anlegen + Mail an den in den
 *     SystemSettings hinterlegten Empfänger.
 *
 *  2. Geräte, die jetzt wieder ONLINE sind und für die ein offener
 *     System-Offline-Alarm existiert → Alarm als CLEARED markieren +
 *     "wieder erreichbar"-Mail senden.
 *
 * Der Alarm-Key `system.device-offline` wird fest verwendet, damit die
 * Logik idempotent ist (kein wiederholtes Versenden beim zweiten Poll).
 */

const ALARM_KEY = 'system.device-offline'
const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 Minuten

let timer: NodeJS.Timeout | null = null

export function startOfflineMonitor(_io: SocketServer): void {
  if (timer) return
  // Ersten Lauf leicht verzögern, damit MQTT-Service erst durch seine
  // initiale Stat-Flut ist.
  setTimeout(() => {
    void runCheck().catch((e) => console.error('[OfflineMonitor] Init-Fehler:', e))
  }, 30_000)
  timer = setInterval(() => {
    void runCheck().catch((e) => console.error('[OfflineMonitor] Tick-Fehler:', e))
  }, POLL_INTERVAL_MS)
  console.log(`[OfflineMonitor] aktiv (Intervall: ${POLL_INTERVAL_MS / 60000} min)`)
}

export function stopOfflineMonitor(): void {
  if (timer) { clearInterval(timer); timer = null }
}

async function runCheck(): Promise<void> {
  const thresholdStr = await getSetting('alarm.offlineThresholdMinutes')
  const thresholdMin = Math.max(1, parseInt(thresholdStr, 10) || 180)
  const email = (await getSetting('alarm.offlineNotificationEmail')).trim()

  const cutoff = new Date(Date.now() - thresholdMin * 60 * 1000)

  // ── Schritt 1: neue Offline-Alarme auslösen ────────────────────────────
  // Nur Geräte berücksichtigen, die einer Anlage zugewiesen sind UND deren
  // Anlage die Offline-Überwachung aktiv hat.
  const devices = await prisma.device.findMany({
    where: {
      status: 'OFFLINE',
      lastSeen: { lte: cutoff },
      isApproved: true,
      anlageDevices: {
        some: { anlage: { offlineMonitoringEnabled: true } },
      },
    },
    select: {
      id: true, name: true, serialNumber: true, lastSeen: true,
      anlageDevices: {
        select: { anlage: { select: { id: true, name: true, projectNumber: true, offlineMonitoringEnabled: true } } },
        orderBy: { assignedAt: 'asc' },
        take: 1,
      },
    },
  })

  for (const d of devices) {
    const anlage = d.anlageDevices[0]?.anlage
    if (!anlage || !anlage.offlineMonitoringEnabled) continue

    const already = await prisma.alarmEvent.findFirst({
      where: { deviceId: d.id, alarmKey: ALARM_KEY, status: 'ACTIVE' },
      select: { id: true },
    })
    if (already) continue

    const event = await prisma.alarmEvent.create({
      data: {
        deviceId: d.id,
        anlageId: anlage.id,
        alarmKey: ALARM_KEY,
        priority: 'PRIO2',
        message: `Gerät ${d.name} seit ${thresholdMin} min offline`,
        source: 'offline-monitor',
        status: 'ACTIVE',
      },
    })
    console.log(`[OfflineMonitor] ${d.serialNumber}: Offline-Alarm erstellt (Event ${event.id})`)

    if (email) {
      await sendOfflineMail(email, {
        kind: 'offline',
        deviceName: d.name,
        serial: d.serialNumber,
        anlageName: anlage.name,
        projectNumber: anlage.projectNumber,
        lastSeen: d.lastSeen,
        thresholdMin,
      }).catch((e) => console.error('[OfflineMonitor] Mail-Versand fehlgeschlagen:', e))

      // Delivery-Log für Konsistenz zur Alarm-Historie
      await prisma.alarmEventDelivery.create({
        data: {
          eventId: event.id, type: 'EMAIL', target: email,
          status: 'SENT', sentAt: new Date(), attemptedAt: new Date(),
        },
      }).catch(() => {})
    }
  }

  // ── Schritt 2: Wiederherstellung erkennen ──────────────────────────────
  // Alle aktiven System-Offline-Events, deren Device inzwischen wieder
  // ONLINE ist, sauber auf CLEARED setzen + Mail.
  const activeOfflineEvents = await prisma.alarmEvent.findMany({
    where: { alarmKey: ALARM_KEY, status: 'ACTIVE' },
    include: {
      device: { select: { id: true, name: true, serialNumber: true, status: true } },
      anlage: { select: { id: true, name: true, projectNumber: true } },
    },
  })

  for (const ev of activeOfflineEvents) {
    if (ev.device.status !== 'ONLINE') continue
    await prisma.alarmEvent.update({
      where: { id: ev.id },
      data: { status: 'CLEARED', clearedAt: new Date() },
    })
    console.log(`[OfflineMonitor] ${ev.device.serialNumber}: wieder online – Event ${ev.id} CLEARED`)

    if (email) {
      await sendOfflineMail(email, {
        kind: 'recovered',
        deviceName: ev.device.name,
        serial: ev.device.serialNumber,
        anlageName: ev.anlage?.name ?? '—',
        projectNumber: ev.anlage?.projectNumber ?? null,
        lastSeen: null,
        thresholdMin,
      }).catch((e) => console.error('[OfflineMonitor] Recovery-Mail fehlgeschlagen:', e))
    }
  }
}

interface MailArgs {
  kind: 'offline' | 'recovered'
  deviceName: string
  serial: string
  anlageName: string
  projectNumber: string | null
  lastSeen: Date | null
  thresholdMin: number
}

async function sendOfflineMail(email: string, p: MailArgs): Promise<void> {
  const isOffline = p.kind === 'offline'
  const color = isOffline ? '#c62828' : '#2e7d32'
  const title = isOffline ? 'Gerät offline' : 'Gerät wieder erreichbar'
  const icon = isOffline ? '⚠️' : '✅'

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #333;">
  <div style="background: ${color}; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 20px;">${icon} ${title}</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 13px;">YControl Cloud – Offline-Überwachung</p>
  </div>
  <div style="border: 1px solid #e0e0e0; border-top: none; padding: 28px 24px; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0;">
      ${isOffline
        ? `Das Gerät ist seit mindestens <strong>${p.thresholdMin} Minuten</strong> nicht mehr erreichbar.`
        : `Das zuvor offline gemeldete Gerät ist wieder online.`}
    </p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
      <tr><td style="padding: 6px 0; color: #666; width: 140px;">Anlage</td><td style="padding: 6px 0;">${escapeHtml(p.anlageName)}${p.projectNumber ? ' <span style="color:#999;">(' + escapeHtml(p.projectNumber) + ')</span>' : ''}</td></tr>
      <tr><td style="padding: 6px 0; color: #666;">Gerät</td><td style="padding: 6px 0;">${escapeHtml(p.deviceName)} <span style="color:#999;">(${escapeHtml(p.serial)})</span></td></tr>
      ${p.lastSeen ? `<tr><td style="padding: 6px 0; color: #666;">Zuletzt gesehen</td><td style="padding: 6px 0;">${p.lastSeen.toLocaleString('de-CH')}</td></tr>` : ''}
      <tr><td style="padding: 6px 0; color: #666;">Zeitpunkt</td><td style="padding: 6px 0;">${new Date().toLocaleString('de-CH')}</td></tr>
    </table>
    <p style="font-size: 13px; color: #999; margin-top: 28px; border-top: 1px solid #eee; padding-top: 16px;">
      Diese Nachricht geht an die zentral in den Systemeinstellungen konfigurierte Adresse.
      Die Offline-Überwachung kann pro Anlage im Alarm-Tab deaktiviert werden.
    </p>
  </div>
</body></html>`

  const subject = isOffline
    ? `[Offline] ${p.anlageName} – ${p.deviceName}`
    : `[Wiederhergestellt] ${p.anlageName} – ${p.deviceName}`

  await sendMail(email, subject, html)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string))
}
