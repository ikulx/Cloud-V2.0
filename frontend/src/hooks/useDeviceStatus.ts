import { useQueryClient } from '@tanstack/react-query'
import type { DeviceStatus } from '../types/model'
import { useSocketEvent } from '../lib/socket'

interface DeviceStatusEvent {
  deviceId: string
  status: DeviceStatus
  lastSeen: string
}

interface DeviceTeleEvent {
  deviceId: string
  [key: string]: unknown
}

export function useDeviceStatus(deviceId?: string) {
  const queryClient = useQueryClient()

  useSocketEvent<DeviceStatusEvent>('device:status', (payload) => {
    if (deviceId && payload.deviceId !== deviceId) return

    const patch = {
      status: payload.status,
      mqttConnected: payload.status === 'ONLINE',
      lastSeen: payload.lastSeen,
    }

    queryClient.setQueryData(['devices', payload.deviceId], (old: Record<string, unknown> | undefined) =>
      old ? { ...old, ...patch } : old
    )
    queryClient.setQueryData(['devices'], (old: Record<string, unknown>[] | undefined) =>
      old?.map((d) => d.id === payload.deviceId ? { ...d, ...patch } : d)
    )
  })

  useSocketEvent<DeviceTeleEvent>('device:tele', (payload) => {
    if (deviceId && payload.deviceId !== deviceId) return

    const { deviceId: _id, ...patch } = payload

    queryClient.setQueryData(['devices', payload.deviceId], (old: Record<string, unknown> | undefined) =>
      old ? { ...old, ...patch } : old
    )
    queryClient.setQueryData(['devices'], (old: Record<string, unknown>[] | undefined) =>
      old?.map((d) => d.id === payload.deviceId ? { ...d, ...patch } : d)
    )
  })
}
