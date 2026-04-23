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
 * Pollt die Pi-VPN-IP an `port` bis sich der Agent-Listener öffnet,
 * dann führt `runOnce(socket)` aus. Wirft, wenn der Listener nicht
 * rechtzeitig kommt.
 */
async function waitForListener(host: string, port: number, totalMs: number): Promise<void> {
  const deadline = Date.now() + totalMs
  let lastErr: Error | null = null
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = new (require('net').Socket)()
        sock.setTimeout(2000)
        sock.once('connect', () => { sock.destroy(); resolve() })
        sock.once('timeout', () => { sock.destroy(); reject(new Error('connect timeout')) })
        sock.once('error', (e: Error) => { sock.destroy(); reject(e) })
        sock.connect(port, host)
      })
      return
    } catch (e) {
      lastErr = e as Error
      await new Promise((r) => setTimeout(r, PI_LISTENER_RETRY_MS))
    }
  }
  throw new Error(`Pi-Listener ${host}:${port} nicht erreichbar (${lastErr?.message ?? 'timeout'})`)
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
router.post('/:id/backups', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const device = await getDeviceWithVpn(deviceId)
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (device.status !== 'ONLINE') { res.status(409).json({ message: 'Gerät ist offline' }); return }
  if (!device.vpnDevice?.vpnIp) {
    res.status(400).json({ message: 'Gerät hat keine VPN-IP. Backup läuft über den WireGuard-Tunnel und benötigt eine VPN-Konfiguration.' })
    return
  }

  const targets = await getActiveBackupTargets()
  if (targets.length === 0) {
    res.status(400).json({ message: 'Es ist kein Backup-Ziel aktiviert. Bitte in den Einstellungen Syno NAS oder Infomaniak Swiss Backup konfigurieren.' })
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const inflight = await pAny.deviceBackup.findFirst({
    where: { deviceId, status: { in: ['PENDING', 'UPLOADING', 'DISTRIBUTING'] } },
    select: { id: true },
  })
  if (inflight) {
    res.status(409).json({ message: 'Es läuft bereits ein Backup für dieses Gerät.' })
    return
  }

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
      synoStatus: targets.find((t) => t.id === 'syno') ? 'PENDING' : 'SKIPPED',
      infomaniakStatus: targets.find((t) => t.id === 'infomaniak') ? 'PENDING' : 'SKIPPED',
      createdById: req.user!.userId,
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
    res.status(503).json({ message: 'MQTT nicht verfügbar' }); return
  }

  logActivity({
    action: 'devices.backup.start',
    entityType: 'devices',
    entityId: device.id,
    details: { entityName: device.name?.trim() || device.serialNumber, backupId: backup.id, targets: targets.map((t) => t.id) },
    req,
    statusCode: 200,
  }).catch(() => {})

  // Antwort sofort, der Pull läuft im Hintergrund.
  res.status(202).json({
    ...backup,
    sizeBytes: backup.sizeBytes !== null && backup.sizeBytes !== undefined ? Number(backup.sizeBytes) : null,
  })

  // Hintergrund-Job: Pi-Listener anfragen und Stream verteilen.
  void runBackupPull(device.vpnDevice.vpnIp, pullPort, pullToken, backup.id, deviceId, objectKey, targets)
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
    await waitForListener(piIp, port, PI_LISTENER_TIMEOUT_MS)
    await pAny.deviceBackup.update({ where: { id: backupId }, data: { status: 'UPLOADING' } })

    let received = 0n
    await new Promise<void>((resolve, reject) => {
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
    })

    const size = statSync(tmpFile).size
    if (size === 0) throw new Error('Leerer Stream vom Pi erhalten')

    await pAny.deviceBackup.update({
      where: { id: backupId },
      data: { status: 'DISTRIBUTING', sizeBytes: BigInt(size) },
    })

    const synoTarget = targets.find((t) => t.id === 'syno')
    const infoTarget = targets.find((t) => t.id === 'infomaniak')

    async function uploadToTarget(t: BackupTarget): Promise<{ ok: boolean; error?: string }> {
      const stream = createReadStream(tmpFile)
      try {
        await t.put(objectKey, stream, size)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }

    const [synoRes, infoRes] = await Promise.all([
      synoTarget ? uploadToTarget(synoTarget) : Promise.resolve(null),
      infoTarget ? uploadToTarget(infoTarget) : Promise.resolve(null),
    ])

    const overallOk = (synoRes?.ok ?? false) || (infoRes?.ok ?? false)

    await pAny.deviceBackup.update({
      where: { id: backupId },
      data: {
        status: overallOk ? 'OK' : 'FAILED',
        uploadToken: null,
        completedAt: new Date(),
        synoStatus: synoRes ? (synoRes.ok ? 'OK' : 'FAILED') : 'SKIPPED',
        synoError: synoRes && !synoRes.ok ? synoRes.error : null,
        infomaniakStatus: infoRes ? (infoRes.ok ? 'OK' : 'FAILED') : 'SKIPPED',
        infomaniakError: infoRes && !infoRes.ok ? infoRes.error : null,
        errorMessage: overallOk ? null : 'Alle Backup-Ziele haben den Upload abgelehnt',
      },
    })

    // Retention: pro Gerät max RETENTION OK-Backups behalten.
    const all = await pAny.deviceBackup.findMany({
      where: { deviceId, status: 'OK' },
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
const restoreSchema = z.object({ target: z.enum(['syno', 'infomaniak']) })
router.post('/:id/backups/:backupId/restore', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const backupId = req.params.backupId as string
  const parsed = restoreSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'target fehlt' }); return }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const backup = await pAny.deviceBackup.findUnique({ where: { id: backupId } })
  if (!backup || backup.deviceId !== deviceId) { res.status(404).json({ message: 'Backup nicht gefunden' }); return }

  const targetField = parsed.data.target === 'syno' ? backup.synoStatus : backup.infomaniakStatus
  if (targetField !== 'OK') { res.status(400).json({ message: 'Backup ist auf diesem Ziel nicht verfügbar' }); return }

  const device = await getDeviceWithVpn(deviceId)
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (device.status !== 'ONLINE') { res.status(409).json({ message: 'Gerät ist offline' }); return }
  if (!device.vpnDevice?.vpnIp) {
    res.status(400).json({ message: 'Gerät hat keine VPN-IP.' }); return
  }

  const target = await resolveBackupTarget(parsed.data.target)
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
    extractTo: '/home/pi/ycontrol-data',
    dockerService: 'ycontrol-rt',
  })
  if (!ok) { res.status(503).json({ message: 'MQTT nicht verfügbar' }); return }

  logActivity({
    action: 'devices.backup.restore',
    entityType: 'devices',
    entityId: deviceId,
    details: { entityName: device.name?.trim() || device.serialNumber, backupId, target: parsed.data.target },
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
    await waitForListener(piIp, port, PI_LISTENER_TIMEOUT_MS)
    const stream = await target.get(objectKey)
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        host: piIp, port, method: 'POST',
        path: `/restore?token=${encodeURIComponent(token)}`,
        headers: { 'Content-Type': 'application/gzip', 'Transfer-Encoding': 'chunked' },
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

export default router
