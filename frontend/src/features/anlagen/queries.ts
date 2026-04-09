import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'
import type { Anlage } from '../../types/model'

export const anlagenKeys = {
  all: ['anlagen'] as const,
  detail: (id: string) => ['anlagen', id] as const,
}

export function useAnlagen() {
  return useQuery({ queryKey: anlagenKeys.all, queryFn: () => apiGet<Anlage[]>('/anlagen') })
}

export function useAnlage(id: string) {
  return useQuery({ queryKey: anlagenKeys.detail(id), queryFn: () => apiGet<Anlage>(`/anlagen/${id}`) })
}

export function useCreateAnlage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPost<Anlage>('/anlagen', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: anlagenKeys.all }),
  })
}

export function useUpdateAnlage(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<Anlage>(`/anlagen/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: anlagenKeys.all })
      qc.invalidateQueries({ queryKey: anlagenKeys.detail(id) })
    },
  })
}

export function useDeleteAnlage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/anlagen/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: anlagenKeys.all }),
  })
}

export function useCreateAnlageTodo(anlageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { title: string; details?: string }) =>
      apiPost(`/anlagen/${anlageId}/todos`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: anlagenKeys.detail(anlageId) }),
  })
}

export function useUpdateAnlageTodo(anlageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ todoId, status }: { todoId: string; status: 'OPEN' | 'DONE' }) =>
      apiPatch(`/anlagen/${anlageId}/todos/${todoId}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: anlagenKeys.detail(anlageId) }),
  })
}

export function useCreateAnlageLog(anlageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { message: string }) => apiPost(`/anlagen/${anlageId}/logs`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: anlagenKeys.detail(anlageId) }),
  })
}
