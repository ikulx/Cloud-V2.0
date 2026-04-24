/**
 * Backup-Targets: Speicherort für Geräte-Backups.
 *
 * Aktuell nur Infomaniak Swiss Backup via Swift (Keystone v3).
 * S3 wurde per Entscheid Swift-only entfernt – der Adapter ist als
 * Interface angelegt, damit weitere Targets (z.B. Backblaze B2,
 * S3-Backup-Ziel für Cross-Cloud-Redundanz) später einfach dazukommen
 * können – siehe `BackupTargetId`.
 */
import type { Readable } from 'stream'
import { getSetting } from '../../routes/settings.router'
import { createSwiftTarget } from './swift.target'

export type BackupTargetId = 'infomaniakSwift'

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
  if (id === 'infomaniakSwift') {
    const enabled = (await getSetting('backup.infomaniakSwift.enabled')) === 'true'
    if (!enabled) return null
    const authUrl = (await getSetting('backup.infomaniakSwift.authUrl')).trim()
    const username = (await getSetting('backup.infomaniakSwift.username')).trim()
    const password = await getSetting('backup.infomaniakSwift.password')
    const userDomain = (await getSetting('backup.infomaniakSwift.userDomain')).trim() || 'Default'
    const projectName = (await getSetting('backup.infomaniakSwift.projectName')).trim()
    const projectDomain = (await getSetting('backup.infomaniakSwift.projectDomain')).trim() || 'Default'
    const region = (await getSetting('backup.infomaniakSwift.region')).trim() || 'RegionOne'
    const container = (await getSetting('backup.infomaniakSwift.container')).trim()
    if (!authUrl || !username || !password || !projectName || !container) return null
    return createSwiftTarget({
      id: 'infomaniakSwift',
      authUrl, username, password, userDomain,
      projectName, projectDomain, region, container,
    })
  }
  return null
}

export async function getActiveBackupTargets(): Promise<BackupTarget[]> {
  const out: BackupTarget[] = []
  for (const id of ['infomaniakSwift'] as BackupTargetId[]) {
    const t = await resolveBackupTarget(id)
    if (t) out.push(t)
  }
  return out
}
