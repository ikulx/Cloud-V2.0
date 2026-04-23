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
  synoStatus: BackupTargetStatus
  synoError: string | null
  infomaniakStatus: BackupTargetStatus
  infomaniakError: string | null
  lastRestoreStatus: RestoreStatus | null
  lastRestoreError: string | null
  lastRestoreAt: string | null
  createdAt: string
  completedAt: string | null
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
    mutationFn: ({ backupId, target }: { backupId: string; target: 'syno' | 'infomaniak' }) =>
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
