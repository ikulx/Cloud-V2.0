import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'
import type { UserGroup } from '../../types/model'

export const groupsKeys = {
  all: ['groups'] as const,
  detail: (id: string) => ['groups', id] as const,
}

export function useGroups() {
  return useQuery({ queryKey: groupsKeys.all, queryFn: () => apiGet<UserGroup[]>('/groups') })
}

export function useGroup(id: string) {
  return useQuery({ queryKey: groupsKeys.detail(id), queryFn: () => apiGet<UserGroup>(`/groups/${id}`) })
}

export function useCreateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPost<UserGroup>('/groups', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsKeys.all }),
  })
}

export function useUpdateGroup(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<UserGroup>(`/groups/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: groupsKeys.all })
      qc.invalidateQueries({ queryKey: groupsKeys.detail(id) })
    },
  })
}

export function useDeleteGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsKeys.all }),
  })
}
