import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

export interface ErzeugerType {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}

const keys = {
  all: ['erzeuger-types'] as const,
}

export function useErzeugerTypes() {
  return useQuery({ queryKey: keys.all, queryFn: () => apiGet<ErzeugerType[]>('/erzeuger-types') })
}

export function useCreateErzeugerType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; sortOrder?: number; isActive?: boolean }) =>
      apiPost<ErzeugerType>('/erzeuger-types', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  })
}

export function useUpdateErzeugerType(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Pick<ErzeugerType, 'name' | 'sortOrder' | 'isActive'>>) =>
      apiPatch<ErzeugerType>(`/erzeuger-types/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  })
}

export function useDeleteErzeugerType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/erzeuger-types/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  })
}
