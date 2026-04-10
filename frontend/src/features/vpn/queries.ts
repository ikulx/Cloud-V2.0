import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut, apiPost, apiDelete } from '../../lib/api'

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface VpnSettings {
  serverPublicKey: string
  serverEndpoint:  string
  serverPort:      number
}

export interface VpnAnlage {
  id:          string
  anlageId:    string
  anlageName:  string
  anlageOrt:   string | null
  subnetIndex: number
  subnetCidr:  string
  piIp:        string
  localPrefix: string
  piPublicKey: string | null
  createdAt:   string
}

export interface VpnPeer {
  id:        string
  name:      string
  publicKey: string
  peerIndex: number
  ip:        string
  userId:    string | null
  user:      { id: string; firstName: string; lastName: string; email: string } | null
  createdAt: string
}

// ─── VPN-Einstellungen ────────────────────────────────────────────────────────

export function useVpnSettings() {
  return useQuery({
    queryKey: ['vpn', 'settings'],
    queryFn:  () => apiGet<VpnSettings>('/vpn/settings'),
  })
}

export function useUpdateVpnSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: VpnSettings) => apiPut('/vpn/settings', data),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['vpn', 'settings'] }),
  })
}

// ─── Anlagen ──────────────────────────────────────────────────────────────────

export function useVpnAnlagen() {
  return useQuery({
    queryKey: ['vpn', 'anlagen'],
    queryFn:  () => apiGet<VpnAnlage[]>('/vpn/anlagen'),
  })
}

export function useEnableVpnAnlage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ anlageId, localPrefix }: { anlageId: string; localPrefix?: string }) =>
      apiPost<VpnAnlage>(`/vpn/anlagen/${anlageId}/enable`, { localPrefix }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vpn'] }),
  })
}

export function useDisableVpnAnlage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (anlageId: string) => apiDelete(`/vpn/anlagen/${anlageId}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['vpn'] }),
  })
}

// ─── Peers ────────────────────────────────────────────────────────────────────

export function useVpnPeers() {
  return useQuery({
    queryKey: ['vpn', 'peers'],
    queryFn:  () => apiGet<VpnPeer[]>('/vpn/peers'),
  })
}

export function useAddVpnPeer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; publicKey: string; userId?: string }) =>
      apiPost<VpnPeer>('/vpn/peers', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vpn', 'peers'] }),
  })
}

export function useDeleteVpnPeer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/vpn/peers/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['vpn', 'peers'] }),
  })
}

export function useDeployVpnToAnlage() {
  return useMutation({
    mutationFn: (anlageId: string) =>
      apiPost<{ ok: boolean; targeted: number; serials: string[] }>(`/vpn/anlagen/${anlageId}/deploy`, {}),
  })
}
