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
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/secret-crypto'

const router = Router()

/**
 * Settings-Keys die BEIM SPEICHERN verschlüsselt werden müssen (AES-256-GCM,
 * siehe lib/secret-crypto.ts). GET liefert sie für den Admin entschlüsselt
 * zurück – der User ist authentifiziert und hat die Permission, die Klartexte
 * zu sehen. Schutz greift gegen DB-Leak (Dump, Replika, Backup-Kopie).
 */
export const SENSITIVE_SETTING_KEYS: ReadonlySet<string> = new Set([
  'smtp.password',
  'deepl.apiKey',
  'twilio.authToken',
  'backup.infomaniakSwift.password',
])

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
  'alarm.offlineNotificationEmail',
  'alarm.offlineThresholdMinutes',
  'alarms.retentionDays',
  'twilio.accountSid',
  'twilio.authToken',
  'twilio.smsSenderId',
  'twilio.callFromNumber',
  'twilio.enabled',
  // Infomaniak Swiss Backup via OpenStack Swift
  'backup.infomaniakSwift.enabled',
  'backup.infomaniakSwift.authUrl',
  'backup.infomaniakSwift.username',
  'backup.infomaniakSwift.password',
  'backup.infomaniakSwift.userDomain',
  'backup.infomaniakSwift.projectName',
  'backup.infomaniakSwift.projectDomain',
  'backup.infomaniakSwift.region',
  'backup.infomaniakSwift.container',
  // Auto-Backup (pro Gerät)
  'backup.autoEnabled',
  'backup.autoIntervalMinutes',
  // Cloud-eigene DB-Backups (pg_dump → Swift)
  'cloud.backup.enabled',
  'cloud.backup.intervalHours',
  'cloud.backup.retentionDays',
  // Todo-Benachrichtigungen: Tagesdigest-Stunde (0-23, lokale Server-TZ)
  'todos.digestHour',
  // Interner Marker: Zeitpunkt des letzten Digest-Versands (verhindert doppelte
  // Digests innerhalb desselben Tages). Wird vom Scheduler beschrieben.
  'todos.lastDigestRunAt',
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
  // Empfänger für automatische Offline-Alerts (leer = deaktiviert global)
  'alarm.offlineNotificationEmail': '',
  // Schwellwert in Minuten, ab wann ein Gerät als "lange offline" gilt (3h = 180)
  'alarm.offlineThresholdMinutes': '180',
  // Aufbewahrung abgeschlossener Alarm-Events (+ Deliveries + Piket-Events)
  'alarms.retentionDays': '180',
  // Twilio SMS / Voice
  'twilio.accountSid': '',
  'twilio.authToken': '',
  // SMS: Alphanumeric Sender ID (3–11 Zeichen, A-Z/0-9, z.B. "YControl").
  // Nicht in allen Ländern möglich (z.B. USA nicht) – dort Twilio-Nummer stattdessen.
  'twilio.smsSenderId': '',
  // Voice: E.164-Absender-Nummer für ausgehende Anrufe.
  'twilio.callFromNumber': '',
  'twilio.enabled': 'false',
  // Infomaniak Swiss Backup – S3
  // Swiss Backup als Swift/OpenStack (Keystone v3 Auth)
  'backup.infomaniakSwift.enabled': 'false',
  'backup.infomaniakSwift.authUrl': 'https://swiss-backup02.infomaniak.com/identity/v3',
  'backup.infomaniakSwift.username': '',
  'backup.infomaniakSwift.password': '',
  'backup.infomaniakSwift.userDomain': 'Default',
  'backup.infomaniakSwift.projectName': '',
  'backup.infomaniakSwift.projectDomain': 'Default',
  'backup.infomaniakSwift.region': 'RegionOne',
  'backup.infomaniakSwift.container': '',
  // Auto-Backup Master-Switch und Intervall (in Minuten). Pro Gerät lässt sich
  // das noch einzeln abschalten via Device.autoBackupEnabled. Default: 1440 min
  // = 24h; für Testzwecke kann der Wert bis auf 5 min runter.
  'backup.autoEnabled': 'true',
  'backup.autoIntervalMinutes': '1440',
  // Cloud-DB-Backup: täglich pg_dump, 14 Tage aufbewahren
  'cloud.backup.enabled': 'true',
  'cloud.backup.intervalHours': '24',
  'cloud.backup.retentionDays': '14',
  // Todo-Digest-Stunde: jeden Tag um 08:00 lokaler Server-Zeit gehen die
  // Reminder-Mails als ein gebündeltes Mail pro Empfänger raus.
  'todos.digestHour': '8',
  'todos.lastDigestRunAt': '',
}

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  const raw = row?.value ?? DEFAULT_SETTINGS[key]
  // Sensible Keys werden at-rest AES-GCM-verschlüsselt abgelegt – hier
  // entschlüsseln wir sie transparent wieder, sodass alle Konsumenten
  // (Mail, S3-Client, Twilio, DeepL) den Klartext wie gewohnt bekommen.
  return SENSITIVE_SETTING_KEYS.has(key) ? decryptSecret(raw) : raw
}

// GET /api/settings
router.get('/', authenticate, requirePermission('devices:read'), async (_req, res) => {
  const rows = await prisma.systemSetting.findMany()
  const result: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    result[row.key] = SENSITIVE_SETTING_KEYS.has(row.key)
      ? decryptSecret(row.value)
      : row.value
  }
  res.json(result)
})

// PATCH /api/settings
router.patch('/', authenticate, requirePermission('devices:update'), async (req, res) => {
  const parsed = z.record(z.string(), z.string()).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  // twilio.callFromNumber MUSS im E.164-Format sein (wenn gesetzt).
  const callFrom = parsed.data['twilio.callFromNumber']
  if (callFrom && callFrom.trim() && !/^\+[1-9]\d{7,14}$/.test(callFrom.trim())) {
    res.status(400).json({ message: 'Anruf-Absender muss im E.164-Format sein (z.B. +41791234567)' })
    return
  }

  const allowed = new Set<string>(SETTING_KEYS)
  const updates = Object.entries(parsed.data).filter(([k]) => allowed.has(k))

  await Promise.all(updates.map(([key, value]) => {
    // Sensible Werte VOR dem DB-Write verschlüsseln. Leere Werte bleiben
    // leer (= Setting-"deaktiviert").
    const stored = (SENSITIVE_SETTING_KEYS.has(key) && value)
      ? encryptSecret(value)
      : value
    return prisma.systemSetting.upsert({ where: { key }, update: { value: stored }, create: { key, value: stored } })
  }))

  // DeepL-Konfig-Cache sofort verwerfen, damit die nächste Übersetzung den
  // neuen Key verwendet.
  if (updates.some(([k]) => k.startsWith('deepl.'))) {
    invalidateDeeplConfigCache()
  }

  const rows = await prisma.systemSetting.findMany()
  const result: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    result[row.key] = SENSITIVE_SETTING_KEYS.has(row.key)
      ? decryptSecret(row.value)
      : row.value
  }
  res.json(result)
})

// POST /api/settings/test-twilio – prüft Twilio-Credentials
router.post('/test-twilio', authenticate, requirePermission('roles:read'), async (_req, res) => {
  const { testTwilioCredentials } = await import('../services/twilio.service')
  const r = await testTwilioCredentials()
  if (r.ok) res.json({ ok: true, message: r.message })
  else      res.status(400).json({ ok: false, message: r.message })
})

// POST /api/settings/test-twilio-sms – versendet eine SMS an `to`
const testSmsSchema = z.object({
  to: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Zielnummer muss im E.164-Format sein (z.B. +41791234567)'),
})
router.post('/test-twilio-sms', authenticate, requirePermission('roles:read'), async (req, res) => {
  const parsed = testSmsSchema.safeParse(req.body)
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Zielnummer ungültig'
    res.status(400).json({ ok: false, message: msg }); return
  }
  const { sendSms } = await import('../services/twilio.service')
  const r = await sendSms(parsed.data.to, 'YControl Cloud – Test-SMS. Konfiguration funktioniert.')
  if (r.ok) res.json({ ok: true, message: `OK – SID ${r.sid}` })
  else      res.status(400).json({ ok: false, message: r.error ?? 'Senden fehlgeschlagen' })
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

// POST /api/settings/test-backup-target – prüft Erreichbarkeit eines Backup-Ziels
const testBackupSchema = z.object({ target: z.enum(['infomaniakSwift']) })
router.post('/test-backup-target', authenticate, requirePermission('roles:read'), async (req, res) => {
  const parsed = testBackupSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ ok: false, message: 'target fehlt' }); return }
  const { resolveBackupTarget } = await import('../services/backup-targets')
  try {
    const t = await resolveBackupTarget(parsed.data.target)
    if (!t) { res.status(400).json({ ok: false, message: 'Ziel nicht aktiv oder unvollständig konfiguriert' }); return }
    await t.test()
    res.json({ ok: true, message: 'Verbindung erfolgreich' })
  } catch (e) {
    res.status(400).json({ ok: false, message: e instanceof Error ? e.message : String(e) })
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
