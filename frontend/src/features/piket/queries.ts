import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

export interface PiketRegionZipRange { id?: string; fromZip: number; toZip: number }
export interface PiketRegionForeignPrefix { id?: string; prefix: string }

export interface PiketRegion {
  id: string
  name: string
  description: string | null
  leaderId: string | null
  leader: { id: string; firstName: string; lastName: string; email: string } | null
  leaderFallbackEmail: string | null
  smsToCallMinutes: number | null
  callToLeaderMinutes: number | null
  zipRanges: PiketRegionZipRange[]
  foreignPrefixes: PiketRegionForeignPrefix[]
}

export interface PiketShift {
  id: string
  regionId: string
  userId: string
  date: string
  region: { id: string; name: string }
  user: { id: string; firstName: string; lastName: string; email: string }
}

export type PiketAlarmState =
  | 'PENDING_SMS' | 'SMS_SENT' | 'CALL_DUE' | 'CALL_SENT'
  | 'LEADER_DUE' | 'LEADER_SENT' | 'ACKNOWLEDGED' | 'NO_TECH_FOUND'

export interface PiketAlarm {
  id: string
  alarmEventId: string
  state: PiketAlarmState
  nextActionAt: string | null
  smsAt: string | null
  callAt: string | null
  leaderAt: string | null
  acknowledgedAt: string | null
  region: { id: string; name: string } | null
  techUser:   { id: string; firstName: string; lastName: string; email: string } | null
  leaderUser: { id: string; firstName: string; lastName: string; email: string } | null
  acknowledgedBy: { id: string; firstName: string; lastName: string } | null
  alarmEvent: {
    id: string
    priority: string
    message: string
    activatedAt: string
    device: { id: string; name: string; serialNumber: string }
    anlage: { id: string; name: string; projectNumber: string | null } | null
  }
  createdAt: string
}

export const piketKeys = {
  regions: () => ['piket', 'regions'] as const,
  shifts:  (from?: string, to?: string, regionId?: string) => ['piket', 'shifts', { from, to, regionId }] as const,
  alarms:  (mine?: boolean) => ['piket', 'alarms', !!mine] as const,
}

// ── Regionen ──
export function usePiketRegions(enabled = true) {
  return useQuery({
    queryKey: piketKeys.regions(),
    queryFn: () => apiGet<PiketRegion[]>('/piket/regions'),
    enabled,
  })
}
export interface PiketRegionPayload {
  name?: string
  description?: string | null
  leaderId?: string | null
  leaderFallbackEmail?: string | null
  smsToCallMinutes?: number | null
  callToLeaderMinutes?: number | null
  zipRanges?: { fromZip: number; toZip: number }[]
  foreignPrefixes?: string[]
}

export function useCreatePiketRegion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PiketRegionPayload) =>
      apiPost<PiketRegion>('/piket/regions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: piketKeys.regions() }),
  })
}
export function useUpdatePiketRegion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & PiketRegionPayload) =>
      apiPatch<PiketRegion>(`/piket/regions/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: piketKeys.regions() }),
  })
}
export function useDeletePiketRegion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/piket/regions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: piketKeys.regions() }),
  })
}

// ── Schichten ──
export function usePiketShifts(params: { from?: string; to?: string; regionId?: string }, enabled = true) {
  const qs = new URLSearchParams()
  if (params.from) qs.set('from', params.from)
  if (params.to)   qs.set('to',   params.to)
  if (params.regionId) qs.set('regionId', params.regionId)
  return useQuery({
    queryKey: piketKeys.shifts(params.from, params.to, params.regionId),
    queryFn: () => apiGet<PiketShift[]>(`/piket/shifts${qs.toString() ? '?' + qs.toString() : ''}`),
    enabled,
  })
}
export function useUpsertPiketShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { regionId: string; userId: string; date: string }) =>
      apiPost<PiketShift>('/piket/shifts', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piket', 'shifts'] }),
  })
}
export function useDeletePiketShift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/piket/shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piket', 'shifts'] }),
  })
}

export interface PiketShiftBulkAssignment { regionId: string; date: string }
export interface PiketShiftBulkResult {
  results: Array<PiketShiftBulkAssignment & { action: 'upsert' | 'delete' | 'skipped_past' }>
}
export function useBulkPiketShifts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { userId: string | null; assignments: PiketShiftBulkAssignment[] }) =>
      apiPost<PiketShiftBulkResult>('/piket/shifts/bulk', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piket', 'shifts'] }),
  })
}

// ── Aktive Alarme + Ack ──
export function usePiketAlarms(mine = false, enabled = true) {
  return useQuery({
    queryKey: piketKeys.alarms(mine),
    queryFn: () => apiGet<PiketAlarm[]>(`/piket/alarms${mine ? '?mine=1' : ''}`),
    enabled,
    refetchInterval: 15000,
  })
}
export interface PiketAlarmLogEntry extends Omit<PiketAlarm, 'techUser'> {
  techUser: { id: string; firstName: string; lastName: string; email: string; phone: string | null } | null
  alarmEvent: PiketAlarm['alarmEvent'] & { clearedAt: string | null; status: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attempts: any
}

export function usePiketLog(days = 30, enabled = true) {
  return useQuery({
    queryKey: ['piket', 'log', days],
    queryFn: () => apiGet<PiketAlarmLogEntry[]>(`/piket/alarms/log?days=${days}`),
    enabled,
  })
}

export function useAckPiketAlarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiPost<PiketAlarm>(`/piket/alarms/${id}/ack`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['piket', 'alarms'] }),
  })
}
