import { prisma } from '../db/prisma'
import { getSetting } from '../routes/settings.router'

/**
 * Alarm-Events-Cleanup
 * ────────────────────
 * Löscht abgeschlossene AlarmEvents (Status != ACTIVE), die älter als
 * `alarms.retentionDays` sind. Deliveries und PiketAlarmEvents hängen via
 * Cascade an AlarmEvent → werden automatisch mitgelöscht.
 *
 * Default: 180 Tage. Setting `alarms.retentionDays` ist configurable.
 */

let timer: NodeJS.Timeout | null = null
const INTERVAL_MS = 24 * 60 * 60 * 1000 // täglich

async function cleanupOldAlarmEvents(): Promise<number> {
  const retentionStr = await getSetting('alarms.retentionDays' as never).catch(() => '180')
  const retentionDays = parseInt(String(retentionStr)) || 180
  if (retentionDays <= 0) return 0
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)

  // Nur abgeschlossene Events löschen (aktive nie, egal wie alt).
  const result = await prisma.alarmEvent.deleteMany({
    where: {
      status: { in: ['CLEARED', 'ACKNOWLEDGED'] },
      activatedAt: { lt: cutoff },
    },
  })
  if (result.count > 0) {
    console.log(`[AlarmEventsCleanup] ${result.count} alte Events (> ${retentionDays} Tage) gelöscht (inkl. Deliveries + Piket-Events via Cascade)`)
  }
  return result.count
}

export function startAlarmEventsCleanup(): void {
  if (timer) return
  setTimeout(() => { void cleanupOldAlarmEvents().catch((err) => console.error('[AlarmEventsCleanup]', err)) }, 15_000)
  timer = setInterval(() => { void cleanupOldAlarmEvents().catch((err) => console.error('[AlarmEventsCleanup]', err)) }, INTERVAL_MS)
  console.log('[AlarmEventsCleanup] aktiv (täglich)')
}

export function stopAlarmEventsCleanup(): void {
  if (timer) { clearInterval(timer); timer = null }
}
