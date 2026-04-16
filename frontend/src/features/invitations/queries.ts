import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDelete } from '../../lib/api'

export interface Invitation {
  id: string
  email: string
  token: string
  roleId: string | null
  groupIds: string[]
  anlageIds: string[]
  deviceIds: string[]
  expiresAt: string
  usedAt: string | null
  createdAt: string
  invitedBy: { id: string; firstName: string; lastName: string }
}

export const invitationKeys = {
  all: ['invitations'] as const,
}

export function useInvitations() {
  return useQuery({
    queryKey: invitationKeys.all,
    queryFn: () => apiGet<Invitation[]>('/invitations'),
  })
}

export function useCreateInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      email: string
      roleId?: string | null
      groupIds?: string[]
      anlageIds?: string[]
      deviceIds?: string[]
    }) => apiPost<Invitation>('/invitations', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationKeys.all }),
  })
}

export function useResendInvitation() {
  return useMutation({
    mutationFn: (id: string) => apiPost<{ message: string }>(`/invitations/${id}/resend`, {}),
  })
}

export function useDeleteInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationKeys.all }),
  })
}
