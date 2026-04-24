import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDelete } from '../../lib/api'

export interface CloudBackup {
  id: string
  objectKey: string
  sizeBytes: number | null
  status: 'PENDING' | 'UPLOADING' | 'DISTRIBUTING' | 'OK' | 'FAILED'
  errorMessage: string | null
  trigger: 'manual' | 'auto'
  createdAt: string
  completedAt: string | null
}

export const cloudBackupKeys = { all: ['cloud-backups'] as const }

export function useCloudBackups() {
  return useQuery({
    queryKey: cloudBackupKeys.all,
    queryFn: () => apiGet<CloudBackup[]>('/cloud-backups'),
    refetchInterval: 5000,
  })
}

export function useTriggerCloudBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<{ ok: true }>('/cloud-backups', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: cloudBackupKeys.all }),
  })
}

export function useDeleteCloudBackup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/cloud-backups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: cloudBackupKeys.all }),
  })
}
