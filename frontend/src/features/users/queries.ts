import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'
import type { UserSummary } from '../../types/model'

export const usersKeys = {
  all: ['users'] as const,
  detail: (id: string) => ['users', id] as const,
}

export function useUsers() {
  return useQuery({ queryKey: usersKeys.all, queryFn: () => apiGet<UserSummary[]>('/users') })
}

export function useUser(id: string) {
  return useQuery({ queryKey: usersKeys.detail(id), queryFn: () => apiGet<UserSummary>(`/users/${id}`) })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPost<UserSummary>('/users', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKeys.all }),
  })
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<UserSummary>(`/users/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKeys.all })
      qc.invalidateQueries({ queryKey: usersKeys.detail(id) })
    },
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKeys.all }),
  })
}
