/**
 * Geräte-Backups (`/api/devices/:id/backups`).
 *
 * Ablauf Backup:
 *   1. Admin POSTet auf /backups → Cloud erzeugt DeviceBackup-Row mit
 *      Einmal-Token, publisht MQTT-Befehl `{action:"backup", uploadUrl, token, jobId}`.
 *   2. Pi-Agent tart `/home/pi/ycontrol-data/external` + `/assets`, streamt
 *      tar.gz an `POST /api/devices/:id/backup-stream/upload?token=…&jobId=…`.
 *   3. Cloud streamt zuerst in temporäre Datei, dann parallel an alle aktiven
 *      Backup-Targets (Syno/Infomaniak). Status pro Target wird gespeichert.
 *   4. Retention: Pro Gerät bleiben max. 5 erfolgreiche Backups; ältere werden
 *      auf den Targets und in der DB gelöscht.
 *
 * Ablauf Restore:
 *   1. Admin POSTet auf /backups/:backupId/restore → Cloud generiert
 *      Download-Token + URL, publisht `{action:"restore", downloadUrl, token}`.
 *   2. Agent stoppt Visu-Container `ycontrol-rt`, läd via GET, entpackt nach
 *      `/home/pi/ycontrol-data/`, startet Container neu, meldet Status auf
 *      `yc/<serial>/resp`.
 */
import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import { promises as fsp, createReadStream, createWriteStream, statSync } from 'fs'
import type { Readable } from 'stream'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { publishCommand } from '../services/mqtt.service'
import { getActiveBackupTargets, type BackupTarget, type BackupTargetId } from '../services/backup-targets'
import { getSetting } from './settings.router'
import { logActivity } from '../services/activity-log.service'

const router = Router()

// Pro Gerät behaltene Backups.
const RETENTION = 5
// Tokens leben 1h – Agent versucht den Upload sofort.
const TOKEN_TTL_MS = 60 * 60 * 1000
// Maximal-Grösse eines Uploads (Sicherheits-Cap, 5 GiB).
const UPLOAD_MAX_BYTES = 5n * 1024n * 1024n * 1024n

// Eingehende Tokens: Map<token, { backupId, deviceId, kind, expiresAt, key? }>.
// In-Memory ist OK, weil Tokens nur Minuten leben und ein Cloud-Restart einen
// laufenden Backup-Job ohnehin abbricht (Status bleibt PENDING und kann vom
// Admin neu gestartet werden).
type UploadTokenEntry = {
  kind: 'upload'
  backupId: string
  deviceId: string
  expiresAt: number
}
type DownloadTokenEntry = {
  kind: 'download'
  backupId: string
  deviceId: string
  target: BackupTargetId
  key: string
  expiresAt: number
}
const tokens = new Map<string, UploadTokenEntry | DownloadTokenEntry>()

function newToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

function consumeToken(token: string): UploadTokenEntry | DownloadTokenEntry | null {
  const entry = tokens.get(token)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) { tokens.delete(token); return null }
  // Tokens sind Einmal: nach Abruf entfernen (für Restore akzeptieren wir die
  // Single-Use-Semantik, der Agent macht genau einen GET).
  tokens.delete(token)
  return entry
}

function objectKeyFor(serial: string, isoTimestamp: string): string {
  // Doppelpunkte aus ISO-Timestamp entfernen, damit Pfade auf allen
  // Targets sauber bleiben.
  const safeTs = isoTimestamp.replace(/[:.]/g, '-')
  return `${serial}/${safeTs}.tar.gz`
}

function devicePrefix(serial: string): string {
  return `${serial}/`
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
// Backup auslösen.
router.post('/:id/backups', authenticate, requirePermission('devices:update'), async (req, res) => {
  const deviceId = req.params.id as string
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, serialNumber: true, status: true, name: true },
  })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (device.status !== 'ONLINE') { res.status(409).json({ message: 'Gerät ist offline' }); return }

  const targets = await getActiveBackupTargets()
  if (targets.length === 0) {
    res.status(400).json({ message: 'Es ist kein Backup-Ziel aktiviert. Bitte in den Einstellungen Syno NAS oder Infomaniak Swiss Backup konfigurieren.' })
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any

  // Es darf nicht mehr als 1 laufender Backup-Job pro Gerät existieren.
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

  const token = newToken()
  const backup = await pAny.deviceBackup.create({
    data: {
      deviceId,
      objectKey,
      uploadToken: token,
      status: 'PENDING',
      synoStatus: targets.find((t) => t.id === 'syno') ? 'PENDING' : 'SKIPPED',
      infomaniakStatus: targets.find((t) => t.id === 'infomaniak') ? 'PENDING' : 'SKIPPED',
      createdById: req.user!.userId,
    },
  })

  tokens.set(token, {
    kind: 'upload',
    backupId: backup.id,
    deviceId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  })

  const serverUrl = (await getSetting('pi.serverUrl')).replace(/\/+$/, '')
  const uploadUrl = `${serverUrl}/api/devices/${deviceId}/backup-stream/upload?token=${token}&jobId=${backup.id}`

  const ok = publishCommand(device.serialNumber, {
    action: 'backup',
    jobId: backup.id,
    uploadUrl,
    paths: ['/home/pi/ycontrol-data/external', '/home/pi/ycontrol-data/assets'],
  })
  if (!ok) {
    await pAny.deviceBackup.update({
      where: { id: backup.id },
      data: { status: 'FAILED', errorMessage: 'MQTT nicht verfügbar' },
    })
    tokens.delete(token)
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

  res.status(202).json({
    ...backup,
    sizeBytes: backup.sizeBytes !== null && backup.sizeBytes !== undefined ? Number(backup.sizeBytes) : null,
  })
})

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

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, serialNumber: true, status: true, name: true },
  })
  if (!device) { res.status(404).json({ message: 'Gerät nicht gefunden' }); return }
  if (device.status !== 'ONLINE') { res.status(409).json({ message: 'Gerät ist offline' }); return }

  const token = newToken()
  tokens.set(token, {
    kind: 'download',
    backupId,
    deviceId,
    target: parsed.data.target,
    key: backup.objectKey,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  })

  const serverUrl = (await getSetting('pi.serverUrl')).replace(/\/+$/, '')
  const downloadUrl = `${serverUrl}/api/devices/${deviceId}/backup-stream/download?token=${token}`

  const ok = publishCommand(device.serialNumber, {
    action: 'restore',
    jobId: backupId,
    downloadUrl,
    extractTo: '/home/pi/ycontrol-data',
    dockerService: 'ycontrol-rt',
  })
  if (!ok) { tokens.delete(token); res.status(503).json({ message: 'MQTT nicht verfügbar' }); return }

  await pAny.deviceBackup.update({
    where: { id: backupId },
    data: { lastRestoreStatus: 'PENDING', lastRestoreError: null, lastRestoreAt: new Date() },
  })

  logActivity({
    action: 'devices.backup.restore',
    entityType: 'devices',
    entityId: deviceId,
    details: { entityName: device.name?.trim() || device.serialNumber, backupId, target: parsed.data.target },
    req,
    statusCode: 200,
  }).catch(() => {})

  res.status(202).json({ ok: true })
})

// ─── POST /api/devices/:id/backup-stream/upload ──────────────────────────────
// Roh-Stream vom Pi-Agent. Kein JSON-Parser (siehe app.ts).
router.post('/:id/backup-stream/upload', async (req, res) => {
  const token = String(req.query.token ?? '')
  const entry = consumeToken(token)
  if (!entry || entry.kind !== 'upload' || entry.deviceId !== req.params.id) {
    res.status(401).json({ message: 'Token ungültig oder abgelaufen' }); return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  await pAny.deviceBackup.update({ where: { id: entry.backupId }, data: { status: 'UPLOADING' } })

  // 1. Eingehenden Stream in Tempfile schreiben (damit wir ihn parallel an
  //    mehrere Targets verteilen können, ohne PassThrough-Backpressure zu
  //    bauen).
  const tmpFile = path.join(os.tmpdir(), `ycbk-${entry.backupId}.tar.gz`)
  let received = 0n

  try {
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(tmpFile)
      req.on('data', (chunk: Buffer) => {
        received += BigInt(chunk.length)
        if (received > UPLOAD_MAX_BYTES) {
          req.destroy(new Error('Upload überschreitet das Maximum'))
        }
      })
      req.on('error', reject)
      ws.on('error', reject)
      ws.on('finish', () => resolve())
      req.pipe(ws)
    })
  } catch (e) {
    await pAny.deviceBackup.update({
      where: { id: entry.backupId },
      data: { status: 'FAILED', errorMessage: 'Upload fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) },
    })
    await fsp.unlink(tmpFile).catch(() => {})
    res.status(400).json({ message: 'Upload fehlgeschlagen' }); return
  }

  const size = statSync(tmpFile).size
  if (size === 0) {
    await pAny.deviceBackup.update({
      where: { id: entry.backupId },
      data: { status: 'FAILED', errorMessage: 'Leerer Upload' },
    })
    await fsp.unlink(tmpFile).catch(() => {})
    res.status(400).json({ message: 'Leerer Upload' }); return
  }

  // 2. An alle aktiven Targets parallel verteilen.
  await pAny.deviceBackup.update({
    where: { id: entry.backupId },
    data: { status: 'DISTRIBUTING', sizeBytes: BigInt(size) },
  })

  const backup = await pAny.deviceBackup.findUnique({ where: { id: entry.backupId } })
  const targets = await getActiveBackupTargets()
  const wantSyno = backup.synoStatus === 'PENDING' && targets.some((t) => t.id === 'syno')
  const wantInfo = backup.infomaniakStatus === 'PENDING' && targets.some((t) => t.id === 'infomaniak')

  async function uploadToTarget(t: BackupTarget): Promise<{ ok: boolean; error?: string }> {
    const stream = createReadStream(tmpFile)
    try {
      await t.put(backup.objectKey, stream, size)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const synoTarget = targets.find((t) => t.id === 'syno')
  const infoTarget = targets.find((t) => t.id === 'infomaniak')
  const [synoRes, infoRes] = await Promise.all([
    wantSyno && synoTarget ? uploadToTarget(synoTarget) : Promise.resolve(null),
    wantInfo && infoTarget ? uploadToTarget(infoTarget) : Promise.resolve(null),
  ])

  await fsp.unlink(tmpFile).catch(() => {})

  const overallOk = (synoRes?.ok ?? false) || (infoRes?.ok ?? false) || (!wantSyno && !wantInfo)

  await pAny.deviceBackup.update({
    where: { id: entry.backupId },
    data: {
      status: overallOk ? 'OK' : 'FAILED',
      uploadToken: null,
      completedAt: new Date(),
      synoStatus: synoRes ? (synoRes.ok ? 'OK' : 'FAILED') : backup.synoStatus,
      synoError: synoRes && !synoRes.ok ? synoRes.error : null,
      infomaniakStatus: infoRes ? (infoRes.ok ? 'OK' : 'FAILED') : backup.infomaniakStatus,
      infomaniakError: infoRes && !infoRes.ok ? infoRes.error : null,
      errorMessage: overallOk ? null : 'Alle Backup-Ziele haben den Upload abgelehnt',
    },
  })

  // 3. Retention: pro Gerät nur die letzten RETENTION OK-Backups behalten.
  const all = await pAny.deviceBackup.findMany({
    where: { deviceId: entry.deviceId, status: 'OK' },
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

  res.json({ ok: overallOk, sizeBytes: size })
})

// ─── GET /api/devices/:id/backup-stream/download ─────────────────────────────
router.get('/:id/backup-stream/download', async (req, res) => {
  const token = String(req.query.token ?? '')
  const entry = consumeToken(token)
  if (!entry || entry.kind !== 'download' || entry.deviceId !== req.params.id) {
    res.status(401).json({ message: 'Token ungültig oder abgelaufen' }); return
  }
  const { resolveBackupTarget } = await import('../services/backup-targets')
  const target = await resolveBackupTarget(entry.target)
  if (!target) { res.status(503).json({ message: 'Backup-Ziel nicht aktiv' }); return }

  let stream: Readable
  try {
    stream = await target.get(entry.key)
  } catch (e) {
    res.status(500).json({ message: 'Download fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)) })
    return
  }
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(entry.key)}"`)
  stream.on('error', (err) => {
    console.warn('[backup] download stream error:', err.message)
    if (!res.headersSent) res.status(500).end()
  })
  stream.pipe(res)
})

export default router
