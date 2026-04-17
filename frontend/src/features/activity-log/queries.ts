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

export interface ActivityLogQuery {
  limit?: number
  offset?: number
  action?: string
  userId?: string
  entityId?: string
}

export function useActivityLog(params: ActivityLogQuery) {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set('limit', String(params.limit))
  if (params.offset !== undefined) qs.set('offset', String(params.offset))
  if (params.action) qs.set('action', params.action)
  if (params.userId) qs.set('userId', params.userId)
  if (params.entityId) qs.set('entityId', params.entityId)

  return useQuery({
    queryKey: ['activity-log', params],
    queryFn: () => apiGet<ActivityLogResponse>(`/activity-log?${qs.toString()}`),
  })
}
