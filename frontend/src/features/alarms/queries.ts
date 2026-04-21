import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

export type AlarmPriority = 'PRIO1' | 'PRIO2' | 'PRIO3' | 'WARNING' | 'INFO'
export type AlarmRecipientType = 'EMAIL' | 'SMS' | 'TELEGRAM'
export type AlarmEventStatus = 'ACTIVE' | 'CLEARED' | 'ACKNOWLEDGED'
export type AlarmDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'

export interface RecipientScheduleDay {
  enabled: boolean
  start: string // "HH:MM"
  end: string   // "HH:MM"
}

export interface RecipientSchedule {
  mode: 'always' | 'weekly'
  days?: RecipientScheduleDay[] // 7 Einträge, index 0 = Montag ... 6 = Sonntag
}

export interface AlarmRecipient {
  id: string
  anlageId: string
  type: AlarmRecipientType
  target: string
  label: string | null
  priorities: AlarmPriority[]
  delayMinutes: number
  schedule: RecipientSchedule | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AlarmEventDelivery {
  id: string
  type: AlarmRecipientType
  target: string
  status: AlarmDeliveryStatus
  sentAt: string | null
  errorMessage: string | null
  createdAt: string
}

export interface AlarmEvent {
  id: string
  deviceId: string
  anlageId: string | null
  alarmKey: string
  priority: AlarmPriority
  message: string
  source: string | null
  status: AlarmEventStatus
  activatedAt: string
  clearedAt: string | null
  acknowledgedAt: string | null
  device: { id: string; name: string; serialNumber: string }
  anlage: { id: string; name: string; projectNumber: string | null } | null
  acknowledgedBy: { id: string; firstName: string; lastName: string } | null
  deliveries: AlarmEventDelivery[]
}

export const alarmKeys = {
  recipients: (anlageId: string) => ['alarms', 'recipients', anlageId] as const,
  events: (filters: Record<string, string | undefined>) => ['alarms', 'events', filters] as const,
}

// ── Empfänger ────────────────────────────────────────────────────────────────

export function useAlarmRecipients(anlageId: string) {
  return useQuery({
    queryKey: alarmKeys.recipients(anlageId),
    queryFn: () => apiGet<AlarmRecipient[]>(`/alarms/recipients?anlageId=${anlageId}`),
    enabled: !!anlageId,
  })
}

export function useCreateAlarmRecipient(anlageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<AlarmRecipient>) =>
      apiPost<AlarmRecipient>('/alarms/recipients', { ...data, anlageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: alarmKeys.recipients(anlageId) }),
  })
}

export function useUpdateAlarmRecipient(anlageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<AlarmRecipient>) =>
      apiPatch<AlarmRecipient>(`/alarms/recipients/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: alarmKeys.recipients(anlageId) }),
  })
}

export function useDeleteAlarmRecipient(anlageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/alarms/recipients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: alarmKeys.recipients(anlageId) }),
  })
}

// ── Events ──────────────────────────────────────────────────────────────────

export function useAlarmEvents(filters: {
  anlageId?: string
  deviceId?: string
  status?: AlarmEventStatus
  priority?: AlarmPriority
  limit?: number
}) {
  const params = new URLSearchParams()
  if (filters.anlageId) params.set('anlageId', filters.anlageId)
  if (filters.deviceId) params.set('deviceId', filters.deviceId)
  if (filters.status) params.set('status', filters.status)
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()
  return useQuery({
    queryKey: alarmKeys.events({
      anlageId: filters.anlageId,
      deviceId: filters.deviceId,
      status: filters.status,
      priority: filters.priority,
      limit: filters.limit ? String(filters.limit) : undefined,
    }),
    queryFn: () => apiGet<AlarmEvent[]>(`/alarms/events${qs ? '?' + qs : ''}`),
  })
}

