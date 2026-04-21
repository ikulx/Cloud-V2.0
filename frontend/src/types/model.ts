export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
export type TodoStatus = 'OPEN' | 'DONE'

export interface Permission {
  id: string
  key: string
  description: string | null
}

export interface Role {
  id: string
  name: string
  description: string | null
  permissions: { permission: Permission }[]
  _count?: { users: number }
}

export interface UserSummary {
  id: string
  email: string
  firstName: string
  lastName: string
  address: string | null
  isActive: boolean
  roleId: string | null
  role: { id: string; name: string } | null
  groupMemberships: { group: { id: string; name: string } }[]
  directAnlagen: { anlage: { id: string; name: string } }[]
  directDevices: { device: { id: string; name: string } }[]
  createdAt: string
  updatedAt: string
}

export interface UserGroup {
  id: string
  name: string
  description: string | null
  members: { user: { id: string; firstName: string; lastName: string; email: string } }[]
  groupAnlagen: { anlage: { id: string; name: string } }[]
  groupDevices: { device: { id: string; name: string } }[]
  _count?: { members: number }
  createdAt: string
  updatedAt: string
}

export interface Device {
  id: string
  name: string
  serialNumber: string
  status: DeviceStatus
  isApproved: boolean
  hasConflict?: boolean
  requestedSerialNumber?: string | null
  piSerial?: string | null
  lastSeen: string | null
  firmwareVersion: string | null
  agentVersion: string | null
  ipAddress: string | null
  projectNumber: string | null
  schemaNumber: string | null
  visuVersion: string | null
  notes: string | null
  anlageDevices: { anlage: { id: string; name: string } }[]
  directUsers: { user: { id: string; firstName: string; lastName: string } }[]
  directGroups: { group: { id: string; name: string } }[]
  mqttConnected?: boolean
  vpnActive?: boolean
  httpActive?: boolean
  hasRouter?: boolean
  hasError?: boolean  // wird später vom Agent gesendet
  vpnDevice?: { vpnIp: string } | null
  parentDeviceId: string | null
  lanTargetIp: string | null
  lanTargetPort: number | null
  parentDevice?: { id: string; name: string } | null
  childDevices?: { id: string; name: string; lanTargetIp: string | null; lanTargetPort: number | null }[]
  todos?: DeviceTodo[]
  logEntries?: DeviceLogEntry[]
  _count?: { todos: number }
  createdAt: string
  updatedAt: string
}

export interface Anlage {
  id: string
  projectNumber: string | null
  name: string
  description: string | null
  street: string | null
  zip: string | null
  city: string | null
  country: string | null
  contactName: string | null
  contactPhone: string | null
  contactMobile: string | null
  contactEmail: string | null
  notes: string | null
  latitude: number | null
  longitude: number | null
  hasHeatPump: boolean
  hasBoiler: boolean
  anlageDevices: { device: { id: string; name: string; status: DeviceStatus; isApproved: boolean } }[]
  directUsers: { user: { id: string; firstName: string; lastName: string } }[]
  groupAnlagen: { group: { id: string; name: string } }[]
  erzeuger: {
    id: string
    typeId: string
    serialNumber: string | null
    sortOrder: number
    type: { id: string; name: string; sortOrder: number; isActive: boolean }
  }[]
  _count?: { anlageDevices: number; todos: number }
  todos?: AnlageTodo[]
  logEntries?: AnlageLogEntry[]
  createdAt: string
  updatedAt: string
}

export interface DeviceTodo {
  id: string
  title: string
  details: string | null
  status: TodoStatus
  createdBy: { id: string; firstName: string; lastName: string }
  createdAt: string
  updatedAt: string
}

export interface AnlageTodo {
  id: string
  title: string
  details: string | null
  status: TodoStatus
  dueDate: string | null
  createdBy: { id: string; firstName: string; lastName: string }
  assignedUsers: { user: { id: string; firstName: string; lastName: string; email: string } }[]
  assignedGroups: { group: { id: string; name: string } }[]
  createdAt: string
  updatedAt: string
}

export interface MyTodo extends AnlageTodo {
  anlage: { id: string; name: string; projectNumber: string | null }
  assignmentMine: boolean
  assignmentViaGroup: boolean
}

export interface DeviceLogEntry {
  id: string
  message: string
  createdBy: { id: string; firstName: string; lastName: string }
  createdAt: string
}

export interface AnlageLogEntry {
  id: string
  message: string
  createdBy: { id: string; firstName: string; lastName: string }
  createdAt: string
}

export interface MeResponse {
  userId: string
  email: string
  firstName: string
  lastName: string
  roleId: string | null
  roleName: string | null
  /** true wenn System-Rolle (voller Zugriff) – gesetzt nur durch Seed, nicht durch Name-Match */
  isSystemRole?: boolean
  permissions: string[]
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  me: MeResponse
}
