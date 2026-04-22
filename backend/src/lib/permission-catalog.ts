export const PERMISSION_CATALOG = [
  'users:read', 'users:create', 'users:update', 'users:delete',
  'devices:read', 'devices:create', 'devices:update', 'devices:delete', 'devices:view_all',
  'anlagen:read', 'anlagen:create', 'anlagen:update', 'anlagen:delete',
  'groups:read', 'groups:create', 'groups:update', 'groups:delete',
  'roles:read', 'roles:create', 'roles:update', 'roles:delete',
  'todos:read', 'todos:create', 'todos:update',
  'logbook:read', 'logbook:create',
  'vpn:manage',
  'activityLog:read',
  'wiki:read', 'wiki:create', 'wiki:update', 'wiki:delete',
  'piket:alarms:read_own', 'piket:alarms:read_all', 'piket:planning:manage', 'piket:log:read',
] as const

export const PRIVILEGED_ROLE_NAMES = ['admin', 'verwalter'] as const

export type PermissionKey = typeof PERMISSION_CATALOG[number]
