import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '../../lib/api'
import type { Device } from '../../types/model'

export const devicesKeys = {
  all: ['devices'] as const,
  detail: (id: string) => ['devices', id] as const,
}

export function useDevices() {
  return useQuery({
    queryKey: devicesKeys.all,
    queryFn: () => apiGet<Device[]>('/devices'),
    refetchInterval: 10000,
  })
}

export function useDevice(id: string) {
  return useQuery({ queryKey: devicesKeys.detail(id), queryFn: () => apiGet<Device>(`/devices/${id}`) })
}

export function useCreateDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPost<Device>('/devices', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: devicesKeys.all }),
  })
}

export function useUpdateDevice(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiPatch<Device>(`/devices/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devicesKeys.all })
      qc.invalidateQueries({ queryKey: devicesKeys.detail(id) })
    },
  })
}

export function useDeleteDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: devicesKeys.all }),
  })
}

export function useApproveDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, isApproved }: { id: string; isApproved: boolean }) =>
      apiPatch<Device>(`/devices/${id}/approve`, { isApproved }),
    onSuccess: () => qc.invalidateQueries({ queryKey: devicesKeys.all }),
  })
}

export function useCreateDeviceTodo(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { title: string; details?: string }) =>
      apiPost(`/devices/${deviceId}/todos`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: devicesKeys.detail(deviceId) }),
  })
}

export function useUpdateDeviceTodo(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ todoId, status }: { todoId: string; status: 'OPEN' | 'DONE' }) =>
      apiPatch(`/devices/${deviceId}/todos/${todoId}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: devicesKeys.detail(deviceId) }),
  })
}

export function useCreateDeviceLog(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { message: string }) => apiPost(`/devices/${deviceId}/logs`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: devicesKeys.detail(deviceId) }),
  })
}

export function useDeviceCommand(deviceId: string) {
  return useMutation({
    mutationFn: (action: string) => apiPost(`/devices/${deviceId}/command`, { action }),
  })
}

export function useCreateLanDevice(parentDeviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; lanTargetIp: string; lanTargetPort?: number; notes?: string }) =>
      apiPost<Device>(`/devices/${parentDeviceId}/lan-devices`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: devicesKeys.all })
      qc.invalidateQueries({ queryKey: devicesKeys.detail(parentDeviceId) })
    },
  })
}

export function useUpdateLanDevice(deviceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name?: string; lanTargetIp?: string; lanTargetPort?: number; notes?: string }) =>
      apiPut<Device>(`/devices/${deviceId}/lan-device`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: devicesKeys.all }),
  })
}

