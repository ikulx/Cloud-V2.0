import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut, apiPost, apiDelete } from '../../lib/api'

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface VpnSettings {
  serverPublicKey: string
  serverEndpoint:  string
  serverPort:      number
}

export interface VpnDeviceRecord {
  id:           string
  deviceId:     string
  deviceName:   string
  serialNumber: string
  isApproved:   boolean
  vpnIp:        string
  localPrefix:  string
  piPublicKey:  string | null
  createdAt:    string
}

export interface DeviceVpnConfig {
  id:          string
  vpnIp:       string
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

// ─── Geräte-VPN ──────────────────────────────────────────────────────────────

/** Alle VPN-Geräte (für VpnPage) */
export function useVpnDevices() {
  return useQuery({
    queryKey: ['vpn', 'devices'],
    queryFn:  () => apiGet<VpnDeviceRecord[]>('/vpn/devices'),
  })
}

/** VPN-Konfiguration für ein einzelnes Gerät (für DeviceDetailPage) */
export function useDeviceVpnConfig(deviceId: string | undefined) {
  return useQuery({
    queryKey: ['vpn', 'device', deviceId],
    queryFn:  () => apiGet<DeviceVpnConfig | null>(`/vpn/devices/${deviceId}`),
    enabled:  !!deviceId,
  })
}

export function useEnableDeviceVpn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ deviceId, vpnIp, localPrefix }: { deviceId: string; vpnIp: string; localPrefix: string }) =>
      apiPost<DeviceVpnConfig>(`/vpn/devices/${deviceId}/enable`, { vpnIp, localPrefix }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['vpn', 'device', vars.deviceId] })
      qc.invalidateQueries({ queryKey: ['vpn', 'devices'] })
    },
  })
}

export function useUpdateDeviceVpn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ deviceId, vpnIp, localPrefix }: { deviceId: string; vpnIp?: string; localPrefix?: string }) =>
      apiPut(`/vpn/devices/${deviceId}`, { vpnIp, localPrefix }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['vpn', 'device', vars.deviceId] })
      qc.invalidateQueries({ queryKey: ['vpn', 'devices'] })
    },
  })
}

export function useDisableDeviceVpn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (deviceId: string) => apiDelete(`/vpn/devices/${deviceId}`),
    onSuccess: (_data, deviceId) => {
      qc.invalidateQueries({ queryKey: ['vpn', 'device', deviceId] })
      qc.invalidateQueries({ queryKey: ['vpn', 'devices'] })
    },
  })
}

export function useDeployVpnToDevice() {
  return useMutation({
    mutationFn: (deviceId: string) =>
      apiPost<{ ok: boolean; serial: string }>(`/vpn/devices/${deviceId}/deploy`, {}),
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
