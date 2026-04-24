import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDelete } from '../../lib/api'

export type BackupTargetStatus = 'SKIPPED' | 'PENDING' | 'OK' | 'FAILED'
export type BackupStatus = 'PENDING' | 'UPLOADING' | 'DISTRIBUTING' | 'OK' | 'FAILED'
export type RestoreStatus = 'PENDING' | 'RUNNING' | 'OK' | 'FAILED'

export interface DeviceBackup {
  id: string
  deviceId: string
  objectKey: string
  sizeBytes: number | null
  status: BackupStatus
  errorMessage: string | null
  infomaniakStatus: BackupTargetStatus
  infomaniakError: string | null
  lastRestoreStatus: RestoreStatus | null
  lastRestoreError: string | null
  lastRestoreAt: string | null
  createdAt: string
  completedAt: string | null
  trigger: 'manual' | 'auto' | 'cross_device'
  isPinned: boolean
  pinnedAt: string | null
}

export const backupsKeys = {
  forDevice: (deviceId: string) => ['device-backups', deviceId] as const,
}

export function useDeviceBackups(deviceId: string) {
  return useQuery({
    queryKey: backupsKeys.forDevice(deviceId),
    queryFn: () => apiGet<DeviceBackup[]>(`/devices/${deviceId}/backups`),
    refetchInterval: 5000,
  })
}

export function useStartBackup(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<DeviceBackup>(`/devices/${deviceId}/backups`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupsKeys.forDevice(deviceId) }),
  })
}

export function useRestoreBackup(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ backupId, target }: { backupId: string; target: 'infomaniak' }) =>
      apiPost(`/devices/${deviceId}/backups/${backupId}/restore`, { target }),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupsKeys.forDevice(deviceId) }),
  })
}

export function useDeleteBackup(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (backupId: string) => apiDelete(`/devices/${deviceId}/backups/${backupId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupsKeys.forDevice(deviceId) }),
  })
}

/** Fixiert ein Backup (max 1 pro Gerät). Pinned-Backups werden von der
 *  Retention ignoriert und können nicht direkt gelöscht werden. */
export function usePinBackup(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (backupId: string) => apiPost(`/devices/${deviceId}/backups/${backupId}/pin`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupsKeys.forDevice(deviceId) }),
  })
}

export function useUnpinBackup(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (backupId: string) => apiPost(`/devices/${deviceId}/backups/${backupId}/unpin`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: backupsKeys.forDevice(deviceId) }),
  })
}

/** Ein verfügbares Backup von einem beliebigen Gerät – für Cross-Device-Restore. */
export interface CrossDeviceBackupSource {
  id: string
  deviceId: string
  deviceName: string | null
  deviceSerial: string | null
  sizeBytes: number | null
  createdAt: string
  completedAt: string | null
}

/**
 * Listet alle OK-Backups aller Geräte die der User restore-fähig einspielen
 * kann. Endpoint liefert 403 wenn die Permission `backups:restore_cross_device`
 * fehlt – in dem Fall zeigt das UI den Button gar nicht erst an.
 */
export function useCrossDeviceBackupSources(enabled: boolean) {
  return useQuery({
    queryKey: ['cross-device-backup-sources'] as const,
    queryFn: () => apiGet<CrossDeviceBackupSource[]>(`/backups/cross-device/sources`),
    enabled,
    refetchInterval: 10000,
  })
}
