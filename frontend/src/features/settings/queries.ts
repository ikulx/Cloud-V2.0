import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '../../lib/api'

export const settingsKeys = { all: ['settings'] as const }

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: () => apiGet<Record<string, string>>('/settings'),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, string>) => apiPatch<Record<string, string>>('/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.all }),
  })
}
