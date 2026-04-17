import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../lib/api'

export interface ActivityLogEntry {
  id: string
  userId: string | null
  userEmail: string | null
  action: string
  entityType: string | null
  entityId: string | null
  details: Record<string, unknown> | null
  method: string | null
  path: string | null
  statusCode: number | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

export interface ActivityLogResponse {
  total: number
  limit: number
  offset: number
  entries: ActivityLogEntry[]
}

export type ActivityCategory = 'security' | 'changes' | 'remote' | 'system' | 'login'

export interface ActivityLogQuery {
  limit?: number
  offset?: number
  search?: string
  actions?: string     // comma-separated action prefixes
  category?: ActivityCategory
  userEmail?: string
  userId?: string
  entityId?: string
  startDate?: string   // ISO
  endDate?: string     // ISO
  sort?: 'asc' | 'desc'
}

export function useActivityLog(params: ActivityLogQuery) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }

  return useQuery({
    queryKey: ['activity-log', params],
    queryFn: () => apiGet<ActivityLogResponse>(`/activity-log?${qs.toString()}`),
  })
}

export interface ActivityLogUser {
  userId: string | null
  userEmail: string | null
}

/** Holt die distinct User aus dem Aktivitätslog (für Filter-Dropdown). */
export function useActivityLogUsers() {
  return useQuery({
    queryKey: ['activity-log', 'users'],
    queryFn: () => apiGet<ActivityLogUser[]>('/activity-log/users'),
    staleTime: 5 * 60_000, // 5 min
  })
}
