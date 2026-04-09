import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api'
import type { Role, Permission } from '../../types/model'

export const rolesKeys = {
  all: ['roles'] as const,
  detail: (id: string) => ['roles', id] as const,
  permissions: ['permissions'] as const,
}

export function useRoles() {
  return useQuery({ queryKey: rolesKeys.all, queryFn: () => apiGet<Role[]>('/roles') })
}

export function useRole(id: string) {
  return useQuery({ queryKey: rolesKeys.detail(id), queryFn: () => apiGet<Role>(`/roles/${id}`) })
}

export function usePermissions() {
  return useQuery({ queryKey: rolesKeys.permissions, queryFn: () => apiGet<Permission[]>('/permissions') })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPost<Role>('/roles', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKeys.all }),
  })
}

export function useUpdateRole(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<Role>(`/roles/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: rolesKeys.all })
      qc.invalidateQueries({ queryKey: rolesKeys.detail(id) })
    },
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKeys.all }),
  })
}
