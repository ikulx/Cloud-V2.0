import { Router } from 'express'
import { z } from 'zod'
import os from 'os'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'
import { cleanupOldActivityLogs } from '../services/activity-log-cleanup.service'
import { env } from '../config/env'
import { testMailRateLimiter } from '../middleware/rate-limit'
import { invalidateDeeplConfigCache, testDeepl } from '../services/deepl.service'

const router = Router()

export const SETTING_KEYS = [
  'pi.serverUrl',
  'pi.mqttHost',
  'pi.mqttPort',
  'smtp.host',
  'smtp.port',
  'smtp.secure',
  'smtp.user',
  'smtp.password',
  'smtp.from',
  'app.url',
  'activityLog.retentionDays',
  'deepl.apiKey',
  'deepl.tier',
] as const

export type SettingKey = typeof SETTING_KEYS[number]

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  'pi.serverUrl': 'https://DEINE-DOMAIN.example.com',
  'pi.mqttHost': 'mqtt.DEINE-DOMAIN.example.com',
  'pi.mqttPort': '1883',
  'smtp.host': '',
  'smtp.port': '587',
  'smtp.secure': 'false',
  'smtp.user': '',
  'smtp.password': '',
  'smtp.from': 'YControl Cloud <noreply@ycontrol.local>',
  'app.url': 'http://localhost:5173',
  'activityLog.retentionDays': '90',
  'deepl.apiKey': '',
  'deepl.tier': 'free',
}

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value ?? DEFAULT_SETTINGS[key]
}

// GET /api/settings
router.get('/', authenticate, requirePermission('devices:read'), async (_req, res) => {
  const rows = await prisma.systemSetting.findMany()
  const result: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const row of rows) result[row.key] = row.value
  res.json(result)
})

// PATCH /api/settings
router.patch('/', authenticate, requirePermission('devices:update'), async (req, res) => {
  const parsed = z.record(z.string(), z.string()).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const allowed = new Set<string>(SETTING_KEYS)
  const updates = Object.entries(parsed.data).filter(([k]) => allowed.has(k))

  await Promise.all(updates.map(([key, value]) =>
    prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  ))

  // DeepL-Konfig-Cache sofort verwerfen, damit die nächste Übersetzung den
  // neuen Key verwendet.
  if (updates.some(([k]) => k.startsWith('deepl.'))) {
    invalidateDeeplConfigCache()
  }

  const rows = await prisma.systemSetting.findMany()
  const result: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const row of rows) result[row.key] = row.value
  res.json(result)
})

// POST /api/settings/test-deepl – prüft API-Key + gibt Kontingent zurück
router.post('/test-deepl', authenticate, requirePermission('roles:read'), async (_req, res) => {
  const result = await testDeepl()
  if (result.ok) {
    res.json({
      ok: true,
      message: result.usage
        ? `OK – genutzt: ${result.usage.count.toLocaleString('de-CH')} / ${result.usage.limit.toLocaleString('de-CH')} Zeichen`
        : 'OK – Übersetzung funktioniert',
      usage: result.usage ?? null,
    })
  } else {
    res.status(400).json({ ok: false, message: result.message })
  }
})

// GET /api/settings/system-info
// Liefert DB-Statistiken und Server-Auslastung.
// Nur für Admins (roles:read = nur Admin).
router.get('/system-info', authenticate, requirePermission('roles:read'), async (_req, res) => {
  try {
    // DB-Verbindung: Host + DB-Name aus der DATABASE_URL extrahieren (Password maskiert)
    const dbUrl = env.databaseUrl ?? ''
    let dbHost: string | null = null
    let dbName: string | null = null
    let dbUser: string | null = null
    try {
      const u = new URL(dbUrl)
      dbHost = u.hostname + (u.port ? `:${u.port}` : '')
      dbName = u.pathname.replace(/^\//, '')
      dbUser = u.username
    } catch { /* ignore */ }

    // Postgres Version (Template-Literal → parametrisierte Query, SQL-Injection-sicher)
    const [{ version }] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`

    // Tabellen-Grössen (inkl. activity_logs)
    const tableSizes = await prisma.$queryRaw<Array<{
      table_name: string
      row_count: bigint
      total_bytes: bigint
      pretty: string
    }>>`
      SELECT
        c.relname                            AS table_name,
        c.reltuples::bigint                  AS row_count,
        pg_total_relation_size(c.oid)        AS total_bytes,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS pretty
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 30
    `

    // Gesamtgrösse der DB
    const [{ db_size_pretty, db_size_bytes }] = await prisma.$queryRaw<Array<{
      db_size_pretty: string
      db_size_bytes: bigint
    }>>`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size_pretty,
             pg_database_size(current_database())::bigint          AS db_size_bytes
    `

    // ActivityLog-Statistiken
    const [logCount, oldestLog, newestLog] = await Promise.all([
      prisma.activityLog.count(),
      prisma.activityLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      prisma.activityLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ])

    // Server-Info
    const mem = process.memoryUsage()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const loadAvg = os.loadavg()  // [1min, 5min, 15min]
    const cpuCount = os.cpus().length
    const uptimeProcess = process.uptime()
    const uptimeSystem  = os.uptime()

    res.json({
      db: {
        host: dbHost,
        name: dbName,
        user: dbUser,
        version: version.split(',')[0],  // "PostgreSQL 16.x …"
        sizeBytes: Number(db_size_bytes),
        sizePretty: db_size_pretty,
        tables: tableSizes.map((t) => ({
          name: t.table_name,
          rowCount: Number(t.row_count),
          totalBytes: Number(t.total_bytes),
          pretty: t.pretty,
        })),
      },
      activityLog: {
        totalCount: logCount,
        oldestAt: oldestLog?.createdAt ?? null,
        newestAt: newestLog?.createdAt ?? null,
      },
      server: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        hostname: os.hostname(),
        cpus: cpuCount,
        loadAvg: loadAvg,  // [1m, 5m, 15m]
        // LoadAvg als Prozent pro Kern (relativ zur CPU-Zahl)
        loadPercent: loadAvg.map((l) => Math.min(100, (l / cpuCount) * 100)),
        memTotal: totalMem,
        memFree: freeMem,
        memUsed: totalMem - freeMem,
        memPercent: ((totalMem - freeMem) / totalMem) * 100,
        processMemRss: mem.rss,
        processMemHeapUsed: mem.heapUsed,
        processMemHeapTotal: mem.heapTotal,
        uptimeProcessSec: Math.floor(uptimeProcess),
        uptimeSystemSec: Math.floor(uptimeSystem),
      },
    })
  } catch (e) {
    console.error('[settings/system-info]', e)
    res.status(500).json({ message: 'System-Info konnte nicht gelesen werden' })
  }
})

// POST /api/settings/activity-log/cleanup
// Manueller Cleanup-Trigger für alte Activity-Log-Einträge
router.post('/activity-log/cleanup', authenticate, requirePermission('roles:read'), async (_req, res) => {
  try {
    const retentionStr = await getSetting('activityLog.retentionDays')
    const retentionDays = parseInt(retentionStr) || 90
    const deleted = await cleanupOldActivityLogs(retentionDays)
    res.json({ deleted, retentionDays })
  } catch (e) {
    console.error('[settings/activity-log/cleanup]', e)
    res.status(500).json({ message: 'Cleanup fehlgeschlagen' })
  }
})

// DELETE /api/settings/activity-log/all
// Löscht ALLE Activity-Log-Einträge (destruktiv, nur Admin)
router.delete('/activity-log/all', authenticate, requirePermission('roles:read'), async (req, res) => {
  try {
    const result = await prisma.activityLog.deleteMany({})
    console.log(`[ActivityLog] Alle Einträge gelöscht (${result.count}) von ${req.user?.email}`)
    res.json({ deleted: result.count })
  } catch (e) {
    console.error('[settings/activity-log/all]', e)
    res.status(500).json({ message: 'Löschen fehlgeschlagen' })
  }
})

// POST /api/settings/test-mail  –  Test-E-Mail senden
router.post('/test-mail', testMailRateLimiter, authenticate, requirePermission('roles:read'), async (req, res) => {
  // roles:read = nur admin (verwalter hat diese Permission nicht)
  const { sendTestMail } = await import('../services/mail.service')
  const email = req.user!.email
  try {
    await sendTestMail(email)
    res.json({ message: `Test-E-Mail an ${email} gesendet.` })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ message: `Senden fehlgeschlagen: ${msg}` })
  }
})

export default router
