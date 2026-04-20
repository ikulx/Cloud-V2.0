import { prisma } from '../db/prisma'

/**
 * Löscht Activity-Log-Einträge, die älter als `retentionDays` sind.
 * Gibt die Anzahl gelöschter Einträge zurück.
 */
export async function cleanupOldActivityLogs(retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    return 0
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)

  const result = await prisma.activityLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  return result.count
}

/**
 * Startet einen periodischen Cleanup (einmal täglich um 03:00 Uhr Serverzeit).
 * Liest Retention-Days aus den System-Settings.
 */
export function startActivityLogCleanupScheduler(): void {
  const runCleanup = async () => {
    try {
      const { getSetting } = await import('../routes/settings.router')
      const retentionStr = await getSetting('activityLog.retentionDays')
      const retentionDays = parseInt(retentionStr) || 90
      if (retentionDays <= 0) return
      const deleted = await cleanupOldActivityLogs(retentionDays)
      if (deleted > 0) {
        console.log(`[ActivityLog] Cleanup: ${deleted} alte Einträge gelöscht (> ${retentionDays} Tage)`)
      }
    } catch (e) {
      console.warn('[ActivityLog] Cleanup-Job fehlgeschlagen:', (e as Error).message)
    }
  }

  // Berechne Zeit bis zum nächsten 03:00 Uhr
  const scheduleNext = (): void => {
    const now = new Date()
    const next = new Date(now)
    next.setHours(3, 0, 0, 0)
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1)
    }
    const delay = next.getTime() - now.getTime()
    setTimeout(() => {
      runCleanup().finally(scheduleNext)
    }, delay)
  }

  // Einmal nach 60 Sekunden laufen lassen (für den Start-Cleanup), dann täglich.
  setTimeout(() => runCleanup().finally(scheduleNext), 60_000)
}
