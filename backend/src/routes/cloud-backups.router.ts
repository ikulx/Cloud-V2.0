/**
 * Cloud-DB-Backups (`/api/cloud-backups`).
 *
 * Der Scheduler erstellt täglich einen pg_dump und schiebt ihn ins Swift-
 * Target. Dieses Router-Modul bietet dem Admin:
 *   GET    /cloud-backups         Liste der letzten ~50 Backups (inkl. Status)
 *   POST   /cloud-backups         Manueller Trigger (202 Accepted)
 *   DELETE /cloud-backups/:id     Löscht DB-Row + Swift-Objekt
 *   GET    /cloud-backups/:id/download   Stream (für lokalen Download)
 *
 * Berechtigung: Admin / System-Rolle. Wir erlauben `users:delete` nicht als
 * Proxy, weil das anderer Scope ist – stattdessen verlangen wir die
 * System-Rolle direkt (isSystemRole-Bypass in requirePermission wird
 * sowieso geprüft), fallback auf eine neue Permission wäre overkill für ein
 * derart sensibles Ops-Feature. Praktisch: nur Admins sehen den Reiter.
 */

import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { prisma } from '../db/prisma'
import { resolveBackupTarget } from '../services/backup-targets'
import { runCloudBackup } from '../services/cloud-backup.service'
import { logActivity } from '../services/activity-log.service'

const router = Router()

/** Nur System-Admins kommen an diese Endpoints. */
function requireAdmin(req: Parameters<Parameters<typeof router.get>[1]>[0], res: Parameters<Parameters<typeof router.get>[1]>[1]): boolean {
  if (!req.user) { res.status(401).json({ message: 'Authentifizierung erforderlich' }); return false }
  if (!req.user.isSystemRole) { res.status(403).json({ message: 'Nur für Admins' }); return false }
  return true
}

// GET /api/cloud-backups
router.get('/', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const rows = await pAny.cloudBackup.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json(rows.map((r: Record<string, unknown>) => ({
    ...r,
    sizeBytes: r.sizeBytes !== null && r.sizeBytes !== undefined ? Number(r.sizeBytes) : null,
  })))
})

// POST /api/cloud-backups   – manueller Trigger
router.post('/', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return
  // Kein synchrones Warten – Antwort sofort, der Dump läuft im Hintergrund.
  // Aber wir müssen den Initial-Create machen, damit der Client die ID hat.
  void runCloudBackup('manual', req.user!.userId).catch((e) => {
    console.error('[cloud-backups] manueller Trigger fehlgeschlagen:', e)
  })
  logActivity({
    action: 'cloud.backup.trigger',
    entityType: 'system',
    details: { trigger: 'manual' },
    req,
    statusCode: 202,
  }).catch(() => {})
  res.status(202).json({ ok: true })
})

// DELETE /api/cloud-backups/:id
router.delete('/:id', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const backup = await pAny.cloudBackup.findUnique({ where: { id: req.params.id } })
  if (!backup) { res.status(404).json({ message: 'Backup nicht gefunden' }); return }

  const target = await resolveBackupTarget('infomaniakSwift')
  if (target) {
    try { await target.delete(backup.objectKey) }
    catch (e) { console.warn('[cloud-backups] Swift-Delete fehlgeschlagen:', (e as Error).message) }
  }
  await pAny.cloudBackup.delete({ where: { id: backup.id } })
  logActivity({
    action: 'cloud.backup.delete',
    entityType: 'system',
    entityId: backup.id,
    details: { objectKey: backup.objectKey },
    req,
    statusCode: 200,
  }).catch(() => {})
  res.json({ ok: true })
})

// GET /api/cloud-backups/:id/download – Admin kann Dump zur Off-Cloud-
// Ablage (USB-Stick, Safe, anderes Infrastruktur-Backup) herunterladen.
router.get('/:id/download', authenticate, async (req, res) => {
  if (!requireAdmin(req, res)) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pAny = prisma as any
  const backup = await pAny.cloudBackup.findUnique({ where: { id: req.params.id } })
  if (!backup || backup.status !== 'OK') { res.status(404).json({ message: 'Backup nicht bereit' }); return }

  const target = await resolveBackupTarget('infomaniakSwift')
  if (!target) { res.status(503).json({ message: 'Swift-Target nicht aktiv' }); return }

  try {
    const stream = await target.get(backup.objectKey)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${path_safe(backup.objectKey)}"`)
    stream.pipe(res)
  } catch (e) {
    res.status(500).json({ message: 'Download fehlgeschlagen: ' + (e as Error).message })
  }
})

function path_safe(key: string): string {
  const base = key.split('/').pop() || 'cloud-backup.dump'
  return base.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export default router
