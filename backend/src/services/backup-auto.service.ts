import { prisma } from '../db/prisma'
import { getSetting } from '../routes/settings.router'
import { startBackupForDevice } from '../routes/backups.router'
import { logActivity } from './activity-log.service'

/**
 * Auto-Backup-Scheduler
 * ─────────────────────
 * Prüft alle 30 Minuten, ob für ein Gerät ein automatisches Backup fällig ist.
 *
 * Fällig ist ein Backup wenn ALLE stimmen:
 *  - Global-Master-Switch 'backup.autoEnabled' = true
 *  - Gerät hat autoBackupEnabled = true
 *  - Gerät ist ONLINE
 *  - lastConfigChangeAt liegt ≥ 'backup.autoIntervalHours' (default 24) zurück
 *  - Seit lastConfigChangeAt wurde KEIN erfolgreiches Backup gemacht
 *  - Es läuft gerade KEIN Backup (PENDING/UPLOADING/DISTRIBUTING)
 *
 * Die eigentliche Backup-Orchestrierung delegiert der Scheduler an die
 * bestehende startBackupForDevice-Funktion aus backups.router.ts – damit
 * sind Retention + Pin-Logik identisch zum manuellen Pfad.
 *
 * Gerätebezogene Fehler werden ins Activity-Log geschrieben aber NICHT
 * erneut versucht – beim nächsten Tick wird sowieso geprüft.
 */

const POLL_INTERVAL_MS = 30 * 60 * 1000 // 30 min
const INITIAL_DELAY_MS = 60 * 1000       // 1 min nach Start

let timer: NodeJS.Timeout | null = null

export function startBackupAutoScheduler(): void {
  if (timer) return
  setTimeout(() => {
    void runTick().catch((e) => console.error('[BackupAuto] Init-Fehler:', e))
  }, INITIAL_DELAY_MS)
  timer = setInterval(() => {
    void runTick().catch((e) => console.error('[BackupAuto] Tick-Fehler:', e))
  }, POLL_INTERVAL_MS)
  console.log(`[BackupAuto] aktiv (Intervall: ${POLL_INTERVAL_MS / 60000} min)`)
}

export function stopBackupAutoScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
}

async function runTick(): Promise<void> {
  const masterEnabled = (await getSetting('backup.autoEnabled')).toLowerCase() === 'true'
  if (!masterEnabled) return

  const intervalHours = Math.max(1, parseInt(await getSetting('backup.autoIntervalHours'), 10) || 24)
  const thresholdMs = intervalHours * 60 * 60 * 1000
  const now = Date.now()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const candidates = await prisma.device.findMany({
    where: {
      status: 'ONLINE',
      autoBackupEnabled: true,
      lastConfigChangeAt: { not: null },
      // LAN-/Child-Geräte haben kein eigenes Backup-Modell → nur echte Pis (parentDeviceId IS NULL).
      parentDeviceId: null,
    },
    select: {
      id: true,
      name: true,
      serialNumber: true,
      lastConfigChangeAt: true,
    },
  })

  for (const device of candidates) {
    if (!device.lastConfigChangeAt) continue
    const idleMs = now - device.lastConfigChangeAt.getTime()
    if (idleMs < thresholdMs) continue

    // Gibt es seit lastConfigChangeAt ein erfolgreiches Backup? Dann nichts tun.
    const lastOk = await pAny.deviceBackup.findFirst({
      where: {
        deviceId: device.id,
        status: 'OK',
        completedAt: { gte: device.lastConfigChangeAt },
      },
      select: { id: true },
    })
    if (lastOk) continue

    // Läuft bereits eines? Skip – beim nächsten Tick wieder prüfen.
    const inflight = await pAny.deviceBackup.findFirst({
      where: { deviceId: device.id, status: { in: ['PENDING', 'UPLOADING', 'DISTRIBUTING'] } },
      select: { id: true },
    })
    if (inflight) continue

    console.log(`[BackupAuto] ${device.serialNumber}: idle ${Math.round(idleMs / 3600_000)}h seit letzter Änderung – starte Auto-Backup`)
    const result = await startBackupForDevice(device.id, 'auto', null)
    if (result.ok) {
      logActivity({
        action: 'devices.backup.auto',
        entityType: 'devices',
        entityId: device.id,
        details: {
          entityName: device.name?.trim() || device.serialNumber,
          backupId: (result.backup as { id: string }).id,
          idleHours: Math.round(idleMs / 3600_000),
          thresholdHours: intervalHours,
        },
        statusCode: 200,
      }).catch(() => {})
    } else {
      console.warn(`[BackupAuto] ${device.serialNumber}: skip – ${result.message}`)
    }
  }
}
