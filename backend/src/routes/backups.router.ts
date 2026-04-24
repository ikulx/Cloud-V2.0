/**
 * Geräte-Backups (`/api/devices/:id/backups`).
 *
 * Transport läuft komplett über den bestehenden WireGuard-Tunnel:
 *   – Cloud-Backend hat eine Route `10.0.0.0/8 → wireguard_container` und
 *     erreicht jeden Pi unter dessen `VpnDevice.vpnIp`.
 *   – Cloudflare/nginx kommen damit weder beim Backup noch beim Restore
 *     zum Tragen → keine Upload-Limits, keine Tunnel-Quotas.
 *
 * Ablauf Backup:
 *   1. Admin POSTet auf /backups → Cloud erzeugt DeviceBackup-Row mit
 *      Pull-Token + Pull-Port, publisht MQTT
 *      `{action:"backup", jobId, pullPort, pullToken, paths}`.
 *   2. Pi-Agent öffnet einen one-shot HTTP-Listener auf 0.0.0.0:<pullPort>,
 *      antwortet auf GET `/backup?token=…` mit dem `tar -czf -`-Stream der
 *      angegebenen Pfade.
 *   3. Cloud verbindet via VPN-IP, streamt den Body in eine Tempfile und
 *      verteilt ihn parallel an alle aktiven Backup-Targets.
 *   4. Retention: pro Gerät bleiben max. 5 OK-Backups erhalten.
 *
 * Ablauf Restore:
 *   1. Admin POSTet auf /backups/:backupId/restore → Cloud öffnet einen
 *      Read-Stream beim Target und lädt die Datei zwischenzeitlich in eine
 *      Tempfile. Anschliessend Pull-Port + Token belegen, MQTT
 *      `{action:"restore", jobId, pullPort, pullToken, dockerService, extractTo}`.
 *   2. Agent öffnet HTTP-Listener, akzeptiert genau einen GET
 *      `/restore?token=…`, stoppt den Visu-Container, entpackt den Stream
 *      nach `/home/pi/ycontrol-data` und startet den Container wieder.
 *   3. Status-Updates kommen wie gewohnt über `yc/<serial>/resp`.
 */
import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import http from 'http'
import { promises as fsp, createReadStream, createWriteStream, statSync } from 'fs'
import type { Readable } from 'stream'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { publishCommand } from '../services/mqtt.service'
import { getActiveBackupTargets, resolveBackupTarget, type BackupTarget } from '../services/backup-targets'
import { logActivity } from '../services/activity-log.service'

const router = Router()

// Pro Gerät behaltene Backups.
const RETENTION = 5
// Maximal-Grösse eines Backups (Sicherheits-Cap, 5 GiB).
const MAX_BACKUP_BYTES = 5n * 1024n * 1024n * 1024n
// Wartezeit auf den Agent-Listener nach dem MQTT-Publish (ms zwischen Retries).
const PI_LISTENER_RETRY_MS = 500
// Maximale Wartezeit, bis sich der Agent-Listener öffnet (ms).
const PI_LISTENER_TIMEOUT_MS = 30_000
// Maximale Gesamtdauer für den Stream (ms).
const PI_TRANSFER_TIMEOUT_MS = 30 * 60 * 1000

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

function pickPort(): number {
  // Ephemeral-Bereich – kollisionsarm und braucht weder root noch Reservation.
  return 49152 + Math.floor(Math.random() * (65535 - 49152))
}

function objectKeyFor(serial: string, isoTimestamp: string): string {
  const safeTs = isoTimestamp.replace(/[:.]/g, '-')
  return `${serial}/${safeTs}.tar.gz`
}

async function getDeviceWithVpn(deviceId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const device = await pAny.device.findUnique({
    where: { id: deviceId },
    select: {
      id: true, serialNumber: true, status: true, name: true,
      vpnDevice: { select: { vpnIp: true } },
    },
  })
  return device
}

/**
 * Versucht `attempt(signal)` so lange, bis es entweder erfolgreich ist oder
 * `totalMs` abgelaufen sind. Zwischen Versuchen wird `PI_LISTENER_RETRY_MS`
 * gewartet. Nur Connection-Errors (ECONNREFUSED, EHOSTUNREACH, …) werden
 * geretried; andere Fehler bubbeln direkt hoch.
 *
 * Wichtig: wir machen KEINE separate „Ping"-Verbindung – der Pi-Listener ist
 * one-shot und würde durch eine Ping-Connection seinen einen Accept verbrauchen.
 * Stattdessen retryt jeder Versuch direkt den echten HTTP-Request.
 */
async function retryUntilConnected<T>(
  totalMs: number,
  attempt: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + totalMs
  let lastErr: Error | null = null
  while (Date.now() < deadline) {
    try {
      return await attempt()
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      const transient = err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH' || err.code === 'ETIMEDOUT'
      if (!transient) throw err
      lastErr = err
      await new Promise((r) => setTimeout(r, PI_LISTENER_RETRY_MS))
    }
  }
  throw new Error(`Pi-Listener nicht erreichbar (${lastErr?.message ?? 'timeout'})`)
}

// ─── GET /api/devices/:id/backups ────────────────────────────────────────────
router.get('/:id/backups', authenticate, requirePermission('devices:read'), async (req, res) => {
  const deviceId = req.params.id as string
  const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true } })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (prisma as any).deviceBackup.findMany({
    where: { deviceId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json(rows.map((r: Record<string, unknown>) => ({
    ...r,
    sizeBytes: r.sizeBytes !== null && r.sizeBytes !== undefined ? Number(r.sizeBytes) : null,
  })))
})

// ─── POST /api/devices/:id/backups ───────────────────────────────────────────
/**
 * Startet für ein Gerät ein Backup und kickt den Background-Pull. Ergebnis
 * ist ein Objekt mit `ok` + (im Erfolgsfall) dem Backup-DB-Record, oder ein
 * Fehler mit HTTP-Status. Wird vom POST-Handler und vom Auto-Backup-Scheduler
 * genutzt, damit beide Pfade identisch laufen (Retention, Logs, etc).
 */
export async function startBackupForDevice(
  deviceId: string,
  trigger: 'manual' | 'auto',
  userId: string | null,
): Promise<
  | { ok: true; backup: Record<string, unknown> }
  | { ok: false; status: number; message: string }
> {
  const device = await getDeviceWithVpn(deviceId)
  if (!device) return { ok: false, status: 404, message: 'Gerät nicht gefunden' }
  if (device.status !== 'ONLINE') return { ok: false, status: 409, message: 'Gerät ist offline' }
  if (!device.vpnDevice?.vpnIp) {
    return { ok: false, status: 400, message: 'Gerät hat keine VPN-IP. Backup läuft über den WireGuard-Tunnel und benötigt eine VPN-Konfiguration.' }
  }
  const targets = await getActiveBackupTargets()
  if (targets.length === 0) {
    return { ok: false, status: 400, message: 'Es ist kein Backup-Ziel aktiviert. Bitte in den Einstellungen Infomaniak Swiss Backup konfigurieren.' }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const inflight = await pAny.deviceBackup.findFirst({
    where: { deviceId, status: { in: ['PENDING', 'UPLOADING', 'DISTRIBUTING'] } },
    select: { id: true },
  })
  if (inflight) return { ok: false, status: 409, message: 'Es läuft bereits ein Backup für dieses Gerät.' }

  const isoTs = new Date().toISOString()
  const objectKey = objectKeyFor(device.serialNumber, isoTs)
  const pullToken = newToken()
  const pullPort = pickPort()

  const backup = await pAny.deviceBackup.create({
    data: {
      deviceId,
      objectKey,
      uploadToken: pullToken,
      status: 'PENDING',
      infomaniakStatus: targets.find((t) => t.id === 'infomaniak') ? 'PENDING' : 'SKIPPED',
      createdById: userId,
      trigger,
    },
  })

  const ok = publishCommand(device.serialNumber, {
    action: 'backup',
    jobId: backup.id,
    pullPort,
    pullToken,
    paths: ['/home/pi/ycontrol-data/external', '/home/pi/ycontrol-data/assets'],
  })
  if (!ok) {
    await pAny.deviceBackup.update({
      where: { id: backup.id },
      data: { status: 'FAILED', errorMessage: 'MQTT nicht verfügbar' },
    })
    return { ok: false, status: 503, message: 'MQTT nicht verfügbar' }
  }

  // Hintergrund-Job starten (Fire-and-forget; Status läuft über DB).
  void runBackupPull(device.vpnDevice.vpnIp, pullPort, pullToken, backup.id, deviceId, objectKey, targets)
  return { ok: true, backup }
}

router.post('/:id/backups', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const result = await startBackupForDevice(deviceId, 'manual', req.user!.userId)
  if (!result.ok) { res.status(result.status).json({ message: result.message }); return }

  const backup = result.backup as { id: string; sizeBytes: bigint | number | null }
  const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { name: true, serialNumber: true } })
  logActivity({
    action: 'devices.backup.start',
    entityType: 'devices',
    entityId: deviceId,
    details: { entityName: device?.name?.trim() || device?.serialNumber, backupId: backup.id, trigger: 'manual' },
    req,
    statusCode: 200,
  }).catch(() => {})

  res.status(202).json({
    ...backup,
    sizeBytes: backup.sizeBytes !== null && backup.sizeBytes !== undefined ? Number(backup.sizeBytes) : null,
  })
})

async function runBackupPull(
  piIp: string,
  port: number,
  token: string,
  backupId: string,
  deviceId: string,
  objectKey: string,
  targets: BackupTarget[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const tmpFile = path.join(os.tmpdir(), `ycbk-${backupId}.tar.gz`)

  try {
    await pAny.deviceBackup.update({ where: { id: backupId }, data: { status: 'UPLOADING' } })

    // Wir retrien direkt mit dem echten GET, weil der one-shot-Pi-Listener
    // nur einen Accept hat – ein separater Ping würde diesen verbrauchen.
    let received = 0n
    await retryUntilConnected(PI_LISTENER_TIMEOUT_MS, () => new Promise<void>((resolve, reject) => {
      const req = http.request({
        host: piIp, port, method: 'GET',
        path: `/backup?token=${encodeURIComponent(token)}`,
        timeout: PI_TRANSFER_TIMEOUT_MS,
      }, (response) => {
        if (response.statusCode !== 200) {
          let body = ''
          response.on('data', (c) => { body += c.toString() })
          response.on('end', () => reject(new Error(`Pi antwortete HTTP ${response.statusCode}: ${body.slice(0, 300)}`)))
          return
        }
        const ws = createWriteStream(tmpFile)
        response.on('data', (chunk: Buffer) => {
          received += BigInt(chunk.length)
          if (received > MAX_BACKUP_BYTES) {
            response.destroy(new Error(`Backup überschreitet ${MAX_BACKUP_BYTES} Bytes`))
          }
        })
        response.on('error', reject)
        ws.on('error', reject)
        ws.on('finish', () => resolve())
        response.pipe(ws)
      })
      req.on('timeout', () => { req.destroy(new Error('Pi-Transfer-Timeout')) })
      req.on('error', reject)
      req.end()
    }))

    const size = statSync(tmpFile).size
    if (size === 0) throw new Error('Leerer Stream vom Pi erhalten')

    await pAny.deviceBackup.update({
      where: { id: backupId },
      data: { status: 'DISTRIBUTING', sizeBytes: BigInt(size) },
    })

    // Beide Infomaniak-Varianten ('infomaniak' = S3, 'infomaniakSwift' = Swift)
    // teilen sich dieselben Status-Columns (DeviceBackup.infomaniakStatus/-Error).
    // Wenn der Admin beide aktiviert hat, wird parallel hochgeladen (Redundanz);
    // Status = OK nur wenn ALLE erfolgreich, sonst FAILED mit gesammelten Meldungen.
    const infoTargets = targets.filter((t) => t.id === 'infomaniak' || t.id === 'infomaniakSwift')

    async function uploadToTarget(t: BackupTarget): Promise<{ ok: boolean; error?: string }> {
      const stream = createReadStream(tmpFile)
      try {
        await t.put(objectKey, stream, size)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: `${t.id}: ${e instanceof Error ? e.message : String(e)}` }
      }
    }

    let infoRes: { ok: boolean; error?: string } | null = null
    if (infoTargets.length > 0) {
      const results = await Promise.all(infoTargets.map(uploadToTarget))
      if (results.every((r) => r.ok)) infoRes = { ok: true }
      else infoRes = { ok: false, error: results.filter((r) => !r.ok).map((r) => r.error).join('; ') }
    }
    const overallOk = infoRes?.ok ?? false

    await pAny.deviceBackup.update({
      where: { id: backupId },
      data: {
        status: overallOk ? 'OK' : 'FAILED',
        uploadToken: null,
        completedAt: new Date(),
        infomaniakStatus: infoRes ? (infoRes.ok ? 'OK' : 'FAILED') : 'SKIPPED',
        infomaniakError: infoRes && !infoRes.ok ? infoRes.error : null,
        errorMessage: overallOk ? null : 'Backup-Ziel hat den Upload abgelehnt',
      },
    })

    // Retention: pro Gerät max RETENTION OK-Backups behalten. Pinned-Backups
    // werden NICHT mitgezählt und NIE gelöscht – dadurch kann ein Admin einen
    // "goldenen Zustand" fixieren, der sich nicht durch neue Backups aus dem
    // Fenster schiebt (effektives Maximum: RETENTION + 1 Pinned).
    const all = await pAny.deviceBackup.findMany({
      where: { deviceId, status: 'OK', isPinned: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, objectKey: true },
    })
    if (all.length > RETENTION) {
      const toDelete = all.slice(RETENTION)
      for (const b of toDelete) {
        for (const t of targets) {
          try { await t.delete(b.objectKey) } catch (e) { console.warn('[backup retention] %s on %s:', b.objectKey, t.id, (e as Error).message) }
        }
        await pAny.deviceBackup.delete({ where: { id: b.id } }).catch(() => {})
      }
    }
  } catch (e) {
    await pAny.deviceBackup.update({
      where: { id: backupId },
      data: { status: 'FAILED', errorMessage: e instanceof Error ? e.message : String(e), uploadToken: null, completedAt: new Date() },
    }).catch(() => {})
    console.error('[backup] %s fehlgeschlagen:', backupId, e)
  } finally {
    await fsp.unlink(tmpFile).catch(() => {})
  }
}

// ─── DELETE /api/devices/:id/backups/:backupId ───────────────────────────────
router.delete('/:id/backups/:backupId', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const backupId = req.params.backupId as string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const backup = await pAny.deviceBackup.findUnique({ where: { id: backupId }, include: { device: { select: { serialNumber: true, name: true } } } })
  if (!backup || backup.deviceId !== deviceId) { res.status(404).json({ message: 'Backup nicht gefunden' }); return }
  // Pinned-Backups sind vor dem Löschen geschützt – UI muss vorher unpinnen.
  if (backup.isPinned) {
    res.status(409).json({ message: 'Backup ist fixiert – bitte erst die Fixierung aufheben.' })
    return
  }

  const targets = await getActiveBackupTargets()
  for (const t of targets) {
    try { await t.delete(backup.objectKey) } catch (e) { console.warn('[backup] delete %s on %s:', backup.objectKey, t.id, (e as Error).message) }
  }
  await pAny.deviceBackup.delete({ where: { id: backupId } })
  logActivity({
    action: 'devices.backup.delete',
    entityType: 'devices',
    entityId: deviceId,
    details: { entityName: backup.device?.name?.trim() || backup.device?.serialNumber, backupId, objectKey: backup.objectKey },
    req,
    statusCode: 200,
  }).catch(() => {})
  res.json({ ok: true })
})

// ─── POST /api/devices/:id/backups/:backupId/restore ─────────────────────────
// 'infomaniak' (S3) und 'infomaniakSwift' (Swift) sind beide Swiss-Backup-
// Produkte; welches aktiv ist, wird in den Settings gewählt. Das Frontend
// kann einfach 'infomaniak' schicken; wir fallen dann automatisch auf
// Swift zurück wenn das gewählte Target nicht konfiguriert ist.
const restoreSchema = z.object({ target: z.enum(['infomaniak', 'infomaniakSwift']) })
router.post('/:id/backups/:backupId/restore', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const backupId = req.params.backupId as string
  const parsed = restoreSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'target fehlt' }); return }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const backup = await pAny.deviceBackup.findUnique({
    where: { id: backupId },
    include: { device: { select: { id: true, name: true, serialNumber: true } } },
  })
  if (!backup) { res.status(404).json({ message: 'Backup nicht gefunden' }); return }
  // Cross-Device-Restore: wenn das Backup NICHT zum Ziel-Gerät gehört, muss
  // der User entweder System-Admin sein oder die explizite Permission haben.
  const isCrossDevice = backup.deviceId !== deviceId
  if (isCrossDevice) {
    const allowed = req.user!.isSystemRole || req.user!.permissions.includes('backups:restore_cross_device')
    if (!allowed) {
      res.status(403).json({ message: 'Keine Berechtigung für Cross-Device-Restore' })
      return
    }
  }

  const targetField = backup.infomaniakStatus
  if (targetField !== 'OK') { res.status(400).json({ message: 'Backup ist auf diesem Ziel nicht verfügbar' }); return }

  const device = await getDeviceWithVpn(deviceId)
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (device.status !== 'ONLINE') { res.status(409).json({ message: 'Gerät ist offline' }); return }
  if (!device.vpnDevice?.vpnIp) {
    res.status(400).json({ message: 'Gerät hat keine VPN-IP.' }); return
  }

  // Gewünschtes Ziel probieren, sonst auf das andere Swiss-Backup-Protokoll
  // ausweichen (beides liegt bei Infomaniak, Status-Columns werden geteilt).
  let target = await resolveBackupTarget(parsed.data.target)
  if (!target) {
    const fallbackId = parsed.data.target === 'infomaniak' ? 'infomaniakSwift' : 'infomaniak'
    target = await resolveBackupTarget(fallbackId)
  }
  if (!target) { res.status(503).json({ message: 'Backup-Ziel nicht aktiv' }); return }

  await pAny.deviceBackup.update({
    where: { id: backupId },
    data: { lastRestoreStatus: 'PENDING', lastRestoreError: null, lastRestoreAt: new Date() },
  })

  const pullPort = pickPort()
  const pullToken = newToken()

  const ok = publishCommand(device.serialNumber, {
    action: 'restore',
    jobId: backupId,
    pullPort,
    pullToken,
    // Muss '/' sein weil unser Backup-tar absolute Pfade enthält (tar strippt
    // nur das führende '/', Archive-Einträge heißen also 'home/pi/…'). Mit
    // extractTo='/home/pi/ycontrol-data' würde das beim Entpacken ein
    // doppelt verschachteltes '/home/pi/ycontrol-data/home/pi/…' ergeben.
    extractTo: '/',
    composeFile: '/home/pi/docker/docker-compose.yml',
  })
  if (!ok) { res.status(503).json({ message: 'MQTT nicht verfügbar' }); return }

  logActivity({
    action: isCrossDevice ? 'devices.backup.restore.crossDevice' : 'devices.backup.restore',
    entityType: 'devices',
    entityId: deviceId,
    details: {
      entityName: device.name?.trim() || device.serialNumber,
      backupId,
      target: parsed.data.target,
      ...(isCrossDevice ? {
        sourceDeviceId: backup.deviceId,
        sourceDeviceName: backup.device?.name?.trim() || backup.device?.serialNumber,
      } : {}),
    },
    req,
    statusCode: 200,
  }).catch(() => {})

  res.status(202).json({ ok: true })

  // Hintergrund: Stream vom Backup-Target zum Pi pushen.
  void runRestorePush(device.vpnDevice.vpnIp, pullPort, pullToken, backupId, target, backup.objectKey)
})

async function runRestorePush(
  piIp: string,
  port: number,
  token: string,
  backupId: string,
  target: BackupTarget,
  objectKey: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  try {
    await retryUntilConnected(PI_LISTENER_TIMEOUT_MS, async () => {
      const stream = await target.get(objectKey)
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          host: piIp, port, method: 'POST',
          path: `/restore?token=${encodeURIComponent(token)}`,
          // KEIN Transfer-Encoding-Header setzen – Node macht das automatisch
          // wenn weder Content-Length noch Transfer-Encoding gesetzt sind.
          // Würden wir es selbst setzen, schickte Node die Bytes ungeframed,
          // der Pi-Parser würde nur den ersten "Chunk-Header" lesen und den
          // Rest verlieren → Restore wäre unvollständig.
          headers: { 'Content-Type': 'application/gzip' },
          timeout: PI_TRANSFER_TIMEOUT_MS,
        }, (response) => {
          let body = ''
          response.on('data', (c) => { body += c.toString() })
          response.on('end', () => {
            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve()
            else reject(new Error(`Pi antwortete HTTP ${response.statusCode}: ${body.slice(0, 300)}`))
          })
        })
        req.on('timeout', () => { req.destroy(new Error('Pi-Restore-Timeout')) })
        req.on('error', reject)
        stream.on('error', reject)
        stream.pipe(req)
      })
    })
    // Erfolg/Fehler bestätigt der Agent zusätzlich auf dem MQTT-resp-Topic;
    // dort wird `lastRestoreStatus` final auf OK/FAILED gesetzt.
  } catch (e) {
    await pAny.deviceBackup.update({
      where: { id: backupId },
      data: {
        lastRestoreStatus: 'FAILED',
        lastRestoreError: e instanceof Error ? e.message : String(e),
        lastRestoreAt: new Date(),
      },
    }).catch(() => {})
    console.error('[restore] %s fehlgeschlagen:', backupId, e)
  }
}

// ─── POST /api/devices/:id/backups/:backupId/pin ─────────────────────────────
// Pro Gerät darf genau EIN Backup pinned sein (Transaktion sorgt dafür).
// Pinned-Backups werden von Retention + Auto-Retention ausgenommen – so kann
// ein "goldener Zustand" dauerhaft erhalten bleiben auch nach vielen neuen
// Backups. Das pinned Backup zählt nicht zum Retention-Max.
router.post('/:id/backups/:backupId/pin', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const backupId = req.params.backupId as string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const backup = await pAny.deviceBackup.findUnique({
    where: { id: backupId },
    include: { device: { select: { name: true, serialNumber: true } } },
  })
  if (!backup || backup.deviceId !== deviceId) { res.status(404).json({ message: 'Backup nicht gefunden' }); return }
  if (backup.status !== 'OK') { res.status(400).json({ message: 'Nur erfolgreiche Backups können fixiert werden' }); return }

  await prisma.$transaction([
    // Altes Pinned für dieses Gerät freigeben (falls es eines gibt).
    pAny.deviceBackup.updateMany({
      where: { deviceId, isPinned: true, NOT: { id: backupId } },
      data: { isPinned: false, pinnedAt: null, pinnedById: null },
    }),
    pAny.deviceBackup.update({
      where: { id: backupId },
      data: { isPinned: true, pinnedAt: new Date(), pinnedById: req.user!.userId },
    }),
  ])
  logActivity({
    action: 'devices.backup.pin',
    entityType: 'devices',
    entityId: deviceId,
    details: { entityName: backup.device?.name?.trim() || backup.device?.serialNumber, backupId },
    req,
    statusCode: 200,
  }).catch(() => {})
  res.json({ ok: true })
})

router.post('/:id/backups/:backupId/unpin', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const backupId = req.params.backupId as string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const backup = await pAny.deviceBackup.findUnique({
    where: { id: backupId },
    include: { device: { select: { name: true, serialNumber: true } } },
  })
  if (!backup || backup.deviceId !== deviceId) { res.status(404).json({ message: 'Backup nicht gefunden' }); return }
  await pAny.deviceBackup.update({
    where: { id: backupId },
    data: { isPinned: false, pinnedAt: null, pinnedById: null },
  })
  logActivity({
    action: 'devices.backup.unpin',
    entityType: 'devices',
    entityId: deviceId,
    details: { entityName: backup.device?.name?.trim() || backup.device?.serialNumber, backupId },
    req,
    statusCode: 200,
  }).catch(() => {})
  res.json({ ok: true })
})

// ─── GET /api/backups/cross-device/sources ───────────────────────────────────
// Für das Cross-Device-Restore-UI: liefert alle OK-Backups aller Geräte, die
// der aufrufende User kennen darf (wie sonst das Devices-Listing). Gatekept
// durch die explizite Permission – ohne sie kann man die Liste gar nicht
// abrufen, das schützt auch versehentliches Anzeigen im Frontend.
export const crossDeviceSourcesRouter: Router = Router()
crossDeviceSourcesRouter.get('/sources', authenticate, async (req, res) => {
  const allowed = req.user!.isSystemRole || req.user!.permissions.includes('backups:restore_cross_device')
  if (!allowed) { res.status(403).json({ message: 'Keine Berechtigung für Cross-Device-Restore' }); return }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const rows = await pAny.deviceBackup.findMany({
    where: { status: 'OK', infomaniakStatus: 'OK' },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { device: { select: { id: true, name: true, serialNumber: true } } },
  })
  res.json(rows.map((r: Record<string, unknown>) => ({
    id: r.id,
    deviceId: r.deviceId,
    deviceName: (r.device as { name?: string } | null)?.name || null,
    deviceSerial: (r.device as { serialNumber?: string } | null)?.serialNumber || null,
    sizeBytes: r.sizeBytes !== null && r.sizeBytes !== undefined ? Number(r.sizeBytes) : null,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
  })))
})

export default router
