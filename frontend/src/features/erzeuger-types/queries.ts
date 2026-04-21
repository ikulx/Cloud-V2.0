import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'

export interface ErzeugerCategory {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface ErzeugerCategoryWithTypes extends ErzeugerCategory {
  types: ErzeugerType[]
}

export interface ErzeugerType {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  categoryId: string | null
  serialRequired: boolean
  category?: ErzeugerCategory | null
}

const keys = {
  types: ['erzeuger-types'] as const,
  categories: ['erzeuger-categories'] as const,
}

// ── Types ──────────────────────────────────────────────────────────────

export function useErzeugerTypes() {
  return useQuery({ queryKey: keys.types, queryFn: () => apiGet<ErzeugerType[]>('/erzeuger-types') })
}

export function useCreateErzeugerType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Pick<ErzeugerType, 'name' | 'sortOrder' | 'isActive' | 'categoryId' | 'serialRequired'>>) =>
      apiPost<ErzeugerType>('/erzeuger-types', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.types })
      qc.invalidateQueries({ queryKey: keys.categories })
    },
  })
}

export function useUpdateErzeugerType(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Pick<ErzeugerType, 'name' | 'sortOrder' | 'isActive' | 'categoryId' | 'serialRequired'>>) =>
      apiPatch<ErzeugerType>(`/erzeuger-types/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.types })
      qc.invalidateQueries({ queryKey: keys.categories })
    },
  })
}

export function useDeleteErzeugerType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/erzeuger-types/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.types })
      qc.invalidateQueries({ queryKey: keys.categories })
    },
  })
}

// ── Categories ─────────────────────────────────────────────────────────

export function useErzeugerCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: () => apiGet<ErzeugerCategoryWithTypes[]>('/erzeuger-categories'),
  })
}

export function useCreateErzeugerCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Pick<ErzeugerCategory, 'name' | 'sortOrder' | 'isActive'>>) =>
      apiPost<ErzeugerCategory>('/erzeuger-categories', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.categories }),
  })
}

export function useUpdateErzeugerCategory(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Pick<ErzeugerCategory, 'name' | 'sortOrder' | 'isActive'>>) =>
      apiPatch<ErzeugerCategory>(`/erzeuger-categories/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.categories }),
  })
}

export function useDeleteErzeugerCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/erzeuger-categories/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.categories }),
  })
}
