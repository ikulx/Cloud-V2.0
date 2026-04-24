import { spawn } from 'child_process'
import { createReadStream, createWriteStream, statSync } from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { prisma } from '../db/prisma'
import { env } from '../config/env'
import { getSetting } from '../routes/settings.router'
import { resolveBackupTarget } from './backup-targets'
import { logActivity } from './activity-log.service'

/**
 * Cloud-DB-Backup
 * ───────────────
 * Legt täglich (oder manuell über den UI-Button) einen pg_dump der
 * Cloud-Postgres an und lädt ihn ins Swift-Target, das auch die
 * Geräte-Backups hält. Objekt-Prefix: `cloud/<ISO>.dump`.
 *
 * Das Dump-Format ist `--format=custom` (komprimiertes binary pg_dump),
 * ideal für Restore via:
 *   pg_restore --clean --if-exists -d $DATABASE_URL cloud-2026-04-24.dump
 *
 * Retention: cloud.backup.retentionDays (Default 14) – OK-Backups älter
 * als X Tage werden nach einem erfolgreichen neuen Dump gelöscht.
 *
 * WICHTIG: die pg_dump-Binary muss im Backend-Container installiert sein
 * (postgresql-client). Ohne die pg_dump-Version die zur Server-Major
 * passt, bricht der Dump mit einer Versions-Warnung ab.
 */

const OBJECT_PREFIX = 'cloud'
const POLL_INTERVAL_MS = 60 * 60 * 1000   // 1h – feingranuläre Intervalle stellt der Admin per Setting ein
const INITIAL_DELAY_MS = 5 * 60 * 1000     // 5 min nach Start, damit der Server erst mal stabilisiert ist

let timer: NodeJS.Timeout | null = null

export function startCloudBackupScheduler(): void {
  if (timer) return
  setTimeout(() => { void runTickCatch() }, INITIAL_DELAY_MS)
  timer = setInterval(() => { void runTickCatch() }, POLL_INTERVAL_MS)
  console.log(`[CloudBackup] Scheduler aktiv (Poll: ${POLL_INTERVAL_MS / 60000} min)`)
}
export function stopCloudBackupScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
}

async function runTickCatch(): Promise<void> {
  try { await runTick() }
  catch (e) { console.error('[CloudBackup] Tick-Fehler:', e) }
}

async function runTick(): Promise<void> {
  const enabled = (await getSetting('cloud.backup.enabled')).toLowerCase() === 'true'
  if (!enabled) return

  const intervalHours = Math.max(1, parseInt(await getSetting('cloud.backup.intervalHours'), 10) || 24)
  const thresholdMs = intervalHours * 60 * 60 * 1000

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const lastOk = await pAny.cloudBackup.findFirst({
    where: { status: 'OK' },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  })
  const age = lastOk?.completedAt ? Date.now() - new Date(lastOk.completedAt).getTime() : Infinity
  if (age < thresholdMs) return

  const inflight = await pAny.cloudBackup.findFirst({
    where: { status: { in: ['PENDING', 'UPLOADING', 'DISTRIBUTING'] } },
    select: { id: true },
  })
  if (inflight) return

  console.log(`[CloudBackup] ${intervalHours}h seit letztem OK-Dump – starte Auto-Backup`)
  await runCloudBackup('auto', null)
}

/**
 * Führt einen kompletten Cloud-Backup-Zyklus aus (pg_dump → Swift → Retention).
 * Kann manuell (UI-Button) oder vom Scheduler aufgerufen werden.
 */
export async function runCloudBackup(
  trigger: 'manual' | 'auto',
  userId: string | null,
): Promise<{ ok: true; backupId: string } | { ok: false; status: number; message: string }> {
  const target = await resolveBackupTarget('infomaniakSwift')
  if (!target) return { ok: false, status: 503, message: 'Swift-Target nicht aktiv' }

  const iso = new Date().toISOString().replace(/[:.]/g, '-')
  const objectKey = `${OBJECT_PREFIX}/${iso}.dump`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const record = await pAny.cloudBackup.create({
    data: {
      objectKey,
      status: 'PENDING',
      trigger,
      createdById: userId,
    },
  })

  const tmpFile = path.join(os.tmpdir(), `ycbk-cloud-${record.id}.dump`)

  try {
    await pAny.cloudBackup.update({ where: { id: record.id }, data: { status: 'UPLOADING' } })
    // pg_dump streamen → Tempfile. Custom-Format ist bereits komprimiert.
    await dumpPostgresToFile(tmpFile)

    const size = statSync(tmpFile).size
    if (size === 0) throw new Error('pg_dump lieferte eine leere Datei')

    await pAny.cloudBackup.update({ where: { id: record.id }, data: { status: 'DISTRIBUTING', sizeBytes: BigInt(size) } })

    await target.put(objectKey, createReadStream(tmpFile), size)

    await pAny.cloudBackup.update({
      where: { id: record.id },
      data: { status: 'OK', completedAt: new Date(), errorMessage: null },
    })

    logActivity({
      action: trigger === 'auto' ? 'cloud.backup.auto' : 'cloud.backup.manual',
      entityType: 'system',
      entityId: record.id,
      details: { backupId: record.id, sizeBytes: size, objectKey },
      statusCode: 200,
    }).catch(() => {})

    await applyRetention(target).catch((e) => console.warn('[CloudBackup] Retention-Fehler:', (e as Error).message))
    return { ok: true, backupId: record.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[CloudBackup] Dump/Upload fehlgeschlagen:', msg)
    await pAny.cloudBackup.update({
      where: { id: record.id },
      data: { status: 'FAILED', errorMessage: msg, completedAt: new Date() },
    }).catch(() => {})
    return { ok: false, status: 500, message: msg }
  } finally {
    await fsp.unlink(tmpFile).catch(() => {})
  }
}

/** Spawnt pg_dump mit Custom-Format und pipet stdout in eine Datei. */
function dumpPostgresToFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // --format=custom (c) + --compress=6 gibt kompaktes binary pg_restore-Format.
    // --no-owner / --no-privileges erleichtert den Restore in eine andere Rolle.
    const args = [
      '--format=custom',
      '--compress=6',
      '--no-owner',
      '--no-privileges',
      '--dbname=' + env.databaseUrl,
    ]
    const proc = spawn('pg_dump', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = createWriteStream(filePath)
    proc.stdout.pipe(out)

    let stderr = ''
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    proc.on('error', (err) => reject(new Error('pg_dump nicht startbar: ' + err.message + ' (postgresql-client installiert?)')))
    proc.on('exit', (code) => {
      out.end(() => {
        if (code !== 0) reject(new Error(`pg_dump exit=${code}: ${stderr.slice(0, 500)}`))
        else resolve()
      })
    })
  })
}

/** Löscht OK-Backups älter als cloud.backup.retentionDays inkl. Swift-Objekt. */
async function applyRetention(target: NonNullable<Awaited<ReturnType<typeof resolveBackupTarget>>>): Promise<void> {
  const retentionDays = Math.max(1, parseInt(await getSetting('cloud.backup.retentionDays'), 10) || 14)
  const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const oldOnes = await pAny.cloudBackup.findMany({
    where: { status: 'OK', completedAt: { lt: cutoff } },
    select: { id: true, objectKey: true },
  })
  for (const b of oldOnes) {
    try { await target.delete(b.objectKey) }
    catch (e) { console.warn('[CloudBackup] Retention-Delete %s:', b.objectKey, (e as Error).message) }
    await pAny.cloudBackup.delete({ where: { id: b.id } }).catch(() => {})
  }
  if (oldOnes.length > 0) console.log(`[CloudBackup] Retention: ${oldOnes.length} Backups > ${retentionDays}d entfernt`)
}
