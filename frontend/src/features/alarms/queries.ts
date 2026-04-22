import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

export type AlarmPriority = 'PRIO1' | 'PRIO2' | 'PRIO3' | 'WARNING' | 'INFO'
export type AlarmRecipientType = 'EMAIL' | 'SMS' | 'TELEGRAM'
export type AlarmEventStatus = 'ACTIVE' | 'CLEARED' | 'ACKNOWLEDGED'
export type AlarmDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED'

export interface RecipientScheduleWindow {
  start: string // "HH:MM"
  end: string   // "HH:MM"
}

export interface RecipientScheduleDay {
  enabled: boolean
  windows: RecipientScheduleWindow[]
}

export interface RecipientSchedule {
  mode: 'always' | 'weekly'
  days?: RecipientScheduleDay[] // 7 Einträge, index 0 = Montag ... 6 = Sonntag
}

// Legacy v1-Shape; vom Backend theoretisch noch ausliefer­bar, wenn Altbestand
// gespeichert ist. Im Frontend normalisieren wir auf v2 beim Laden.
interface LegacyScheduleDay { enabled: boolean; start?: string; end?: string }

/** Macht beliebige (v1/v2) Zeitplan-Daten zum einheitlichen v2-Format. */
export function normalizeSchedule(raw: unknown): RecipientSchedule | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as { mode?: string; days?: unknown[] }
  if (s.mode !== 'weekly') return { mode: 'always' }
  if (!Array.isArray(s.days)) return { mode: 'always' }

  const days: RecipientScheduleDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = s.days[i] as (RecipientScheduleDay & LegacyScheduleDay) | undefined
    const enabled = !!d?.enabled
    let windows: RecipientScheduleWindow[] = []
    if (d && Array.isArray(d.windows)) {
      windows = d.windows
        .filter((w) => w && typeof w.start === 'string' && typeof w.end === 'string')
        .map((w) => ({ start: w.start, end: w.end }))
    } else if (d && typeof d.start === 'string' && typeof d.end === 'string') {
      windows = [{ start: d.start, end: d.end }]
    }
    days.push({ enabled, windows })
  }
  return { mode: 'weekly', days }
}

export interface InternalAlarmTemplate {
  id: string
  key: string
  label: string
  email: string | null
  isSystem: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
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
  /** true = interner Empfänger (nur für Admin/Verwalter sichtbar) */
  isInternal: boolean
  /** Optional: FK auf ein InternalAlarmTemplate. Wenn gesetzt, kommt die
   *  E-Mail aus dem Template (zentrale Pflege). */
  templateId: string | null
  /** Vom Backend mitgeliefertes Template-Objekt (Label + aktuelle E-Mail). */
  template: Pick<InternalAlarmTemplate, 'id' | 'label' | 'email' | 'isSystem'> | null
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
  internalTemplates: () => ['alarms', 'internal-templates'] as const,
}

// ── Interne Empfänger-Templates (admin only) ───────────────────────────────

export function useInternalAlarmTemplates(enabled = true) {
  return useQuery({
    queryKey: alarmKeys.internalTemplates(),
    queryFn: () => apiGet<InternalAlarmTemplate[]>('/alarms/internal-templates'),
    enabled,
  })
}

export function useUpdateInternalAlarmTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string | null }) =>
      apiPatch<InternalAlarmTemplate>(`/alarms/internal-templates/${id}`, { email }),
    onSuccess: () => qc.invalidateQueries({ queryKey: alarmKeys.internalTemplates() }),
  })
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

