/**
 * Backup-Targets: Abstraktion über Speicherorte für Geräte-Backups.
 *
 * Aktive Implementierungen:
 *   - syno        → Synology-NAS via WebDAV
 *   - infomaniak  → Infomaniak Swiss Backup via S3
 *
 * Beide werden parallel beschickt, wenn aktiv. Settings liegen in der
 * SystemSetting-Tabelle (Keys siehe routes/settings.router.ts).
 */
import type { Readable } from 'stream'
import { getSetting } from '../../routes/settings.router'
import { createWebdavTarget } from './webdav.target'
import { createS3Target } from './s3.target'

export type BackupTargetId = 'syno' | 'infomaniak'

export interface BackupObject {
  key: string
  size: number
  mtime: Date
}

export interface BackupTarget {
  id: BackupTargetId
  put(key: string, body: Readable, size: number): Promise<void>
  list(prefix: string): Promise<BackupObject[]>
  get(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  test(): Promise<void>
}

export async function resolveBackupTarget(id: BackupTargetId): Promise<BackupTarget | null> {
  if (id === 'syno') {
    const enabled = (await getSetting('backup.syno.enabled')) === 'true'
    if (!enabled) return null
    const url = (await getSetting('backup.syno.url')).trim()
    const user = (await getSetting('backup.syno.user')).trim()
    const password = await getSetting('backup.syno.password')
    const basePath = (await getSetting('backup.syno.basePath')).trim() || '/'
    if (!url || !user) return null
    return createWebdavTarget({ id: 'syno', url, user, password, basePath })
  }
  if (id === 'infomaniak') {
    const enabled = (await getSetting('backup.infomaniak.enabled')) === 'true'
    if (!enabled) return null
    const endpoint = (await getSetting('backup.infomaniak.endpoint')).trim()
    const region = (await getSetting('backup.infomaniak.region')).trim() || 'rma'
    const bucket = (await getSetting('backup.infomaniak.bucket')).trim()
    const accessKey = (await getSetting('backup.infomaniak.accessKey')).trim()
    const secretKey = await getSetting('backup.infomaniak.secretKey')
    if (!endpoint || !bucket || !accessKey || !secretKey) return null
    return createS3Target({ id: 'infomaniak', endpoint, region, bucket, accessKey, secretKey })
  }
  return null
}

export async function getActiveBackupTargets(): Promise<BackupTarget[]> {
  const out: BackupTarget[] = []
  for (const id of ['syno', 'infomaniak'] as BackupTargetId[]) {
    const t = await resolveBackupTarget(id)
    if (t) out.push(t)
  }
  return out
}
