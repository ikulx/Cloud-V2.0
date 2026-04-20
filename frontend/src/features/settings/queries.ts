import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost } from '../../lib/api'

export const settingsKeys = { all: ['settings'] as const, system: ['settings', 'system-info'] as const }

export function useSettings(enabled: boolean = true) {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => apiGet<Record<string, string>>('/settings'),
    enabled,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, string>) => apiPatch<Record<string, string>>('/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.all }),
  })
}

// ─── System-Info ──────────────────────────────────────────────────────────────

export interface SystemInfoDbTable {
  name: string
  rowCount: number
  totalBytes: number
  pretty: string
}

export interface SystemInfo {
  db: {
    host: string | null
    name: string | null
    user: string | null
    version: string
    sizeBytes: number
    sizePretty: string
    tables: SystemInfoDbTable[]
  }
  activityLog: {
    totalCount: number
    oldestAt: string | null
    newestAt: string | null
  }
  server: {
    platform: string
    arch: string
    nodeVersion: string
    hostname: string
    cpus: number
    loadAvg: number[]
    loadPercent: number[]
    memTotal: number
    memFree: number
    memUsed: number
    memPercent: number
    processMemRss: number
    processMemHeapUsed: number
    processMemHeapTotal: number
    uptimeProcessSec: number
    uptimeSystemSec: number
  }
}

export function useSystemInfo(enabled: boolean = true) {
  return useQuery({
    queryKey: settingsKeys.system,
    queryFn: () => apiGet<SystemInfo>('/settings/system-info'),
    enabled,
    refetchInterval: 10_000,  // alle 10s aktualisieren (Server-Last)
  })
}

export function useCleanupActivityLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<{ deleted: number; retentionDays: number }>('/settings/activity-log/cleanup', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.system }),
  })
}
