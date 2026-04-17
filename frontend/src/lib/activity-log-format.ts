import type { TFunction } from 'i18next'
import type { ActivityLogEntry } from '../features/activity-log/queries'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Menschenlesbare Bezeichnung für einen Entity-Typ */
function entityLabel(key: string, t: TFunction): string {
  const map: Record<string, string> = {
    anlagen:     t('activityLog.entity.anlage', 'Anlage'),
    devices:     t('activityLog.entity.device', 'Gerät'),
    users:       t('activityLog.entity.user', 'Benutzer'),
    groups:      t('activityLog.entity.group', 'Gruppe'),
    roles:       t('activityLog.entity.role', 'Rolle'),
    permissions: t('activityLog.entity.permission', 'Permission'),
    vpn:         t('activityLog.entity.vpn', 'VPN'),
    settings:    t('activityLog.entity.settings', 'Einstellungen'),
    invitations: t('activityLog.entity.invitation', 'Einladung'),
    me:          t('activityLog.entity.user', 'Benutzer'),
    todos:       t('activityLog.entity.todo', 'Todo'),
    logs:        t('activityLog.entity.log', 'Logbuch-Eintrag'),
    peers:       t('activityLog.entity.peer', 'VPN-Peer'),
    permission:  t('activityLog.entity.permission', 'Permission'),
  }
  return map[key] ?? key
}

function verbLabel(verb: string, t: TFunction): string {
  switch (verb) {
    case 'create': return t('activityLog.verb.create', 'erstellt')
    case 'update': return t('activityLog.verb.update', 'bearbeitet')
    case 'delete': return t('activityLog.verb.delete', 'gelöscht')
    default: return verb
  }
}

/**
 * Menschenlesbarer Titel für einen Log-Eintrag.
 * Nutzt entityName aus den Details (wenn vorhanden) für "Anlage 'Hauptheizung' bearbeitet".
 */
export function formatActionTitle(entry: ActivityLogEntry, t: TFunction): string {
  const a = entry.action ?? ''
  const entityName = extractEntityName(entry)

  // Spezialfälle mit eigenem Rendering
  switch (a) {
    case 'auth.login':        return t('activityLog.action.login', 'Anmeldung')
    case 'auth.login.failed': return t('activityLog.action.loginFailed', 'Fehlgeschlagene Anmeldung')
    case 'auth.logout':       return t('activityLog.action.logout', 'Abmeldung')
    case 'vpn.visu.open':     return entityName
      ? t('activityLog.action.visuOpen', 'Fernzugriff geöffnet: {{name}}', { name: entityName })
      : t('activityLog.action.visuOpenGeneric', 'Fernzugriff geöffnet')
    case 'vpn.deploy':        return entityName
      ? t('activityLog.action.vpnDeploy', 'VPN auf "{{name}}" deployed', { name: entityName })
      : t('activityLog.action.vpnDeployGeneric', 'VPN deployed')
    case 'vpn.config.download': return formatConfigDownload(entry, t)
    case 'permission.denied': return t('activityLog.action.permissionDenied', 'Berechtigung verweigert')
    case 'users.password.update': return entityName
      ? t('activityLog.action.passwordChanged', 'Passwort geändert: {{name}}', { name: entityName })
      : t('activityLog.action.passwordChangedGeneric', 'Passwort geändert')
    case 'roles.permissions.update': return entityName
      ? t('activityLog.action.rolePermissions', 'Rollen-Permissions "{{name}}" geändert', { name: entityName })
      : t('activityLog.action.rolePermissionsGeneric', 'Rollen-Permissions geändert')
    case 'system.projectNumber.autoSync': return entityName
      ? t('activityLog.action.autoSyncPn', 'Projektnummer auf "{{name}}" synchronisiert', { name: entityName })
      : t('activityLog.action.autoSyncPnGeneric', 'Projektnummer automatisch synchronisiert')
  }

  // Gerät-Befehle: devices.command.<action>
  if (a.startsWith('devices.command.')) {
    const cmd = a.substring('devices.command.'.length)
    const cmdLabel = commandLabel(cmd, t)
    return entityName
      ? t('activityLog.action.deviceCommand', '{{cmd}} an "{{name}}"', { cmd: cmdLabel, name: entityName })
      : cmdLabel
  }

  // Generisch: <entity>.<verb> oder <entity>.<sub>.<verb>
  const segments = a.split('.')
  const verb = segments[segments.length - 1]
  const entityParts = segments.slice(0, -1).filter((p) => !UUID_RE.test(p))

  if (entityParts.length === 0) return verbLabel(verb, t)

  if (entityParts.length === 1) {
    const base = entityLabel(entityParts[0], t)
    return entityName
      ? `${base} "${entityName}" ${verbLabel(verb, t)}`
      : `${base} ${verbLabel(verb, t)}`
  }

  const parent = entityLabel(entityParts[0], t)
  const sub = entityLabel(entityParts[entityParts.length - 1], t)
  return entityName
    ? `${sub} ${verbLabel(verb, t)} · ${t('activityLog.contextPrefix', 'in')} ${parent} "${entityName}"`
    : `${sub} ${verbLabel(verb, t)} · ${t('activityLog.contextPrefix', 'in')} ${parent}`
}

function formatConfigDownload(entry: ActivityLogEntry, t: TFunction): string {
  const d = entry.details as Record<string, unknown> | null
  const type = (d?.configType as string) ?? ''
  const name = (d?.entityName as string) ?? ''
  if (type === 'server-config') return t('activityLog.action.dlServer', 'Server-Config heruntergeladen')
  if (type === 'pi-config') return name
    ? t('activityLog.action.dlPi', 'Pi-Config "{{name}}" heruntergeladen', { name })
    : t('activityLog.action.dlPiGeneric', 'Pi-Config heruntergeladen')
  if (type === 'peer-config') return name
    ? t('activityLog.action.dlPeer', 'Peer-Config "{{name}}" heruntergeladen', { name })
    : t('activityLog.action.dlPeerGeneric', 'Peer-Config heruntergeladen')
  return t('activityLog.action.dlConfig', 'VPN-Config heruntergeladen')
}

function commandLabel(cmd: string, t: TFunction): string {
  switch (cmd) {
    case 'ping':              return t('activityLog.command.ping', 'Ping')
    case 'refresh':           return t('activityLog.command.refresh', 'Aktualisieren')
    case 'restart':           return t('activityLog.command.restart', 'Neustart')
    case 'update':            return t('activityLog.command.update', 'Agent-Update')
    case 'setName':           return t('activityLog.command.setName', 'Name setzen')
    case 'setProjectNumber':  return t('activityLog.command.setProjectNumber', 'Projektnummer setzen')
    case 'vpn_install':       return t('activityLog.command.vpnInstall', 'VPN installieren')
    case 'vpn_remove':        return t('activityLog.command.vpnRemove', 'VPN entfernen')
    default:                  return cmd
  }
}

function extractEntityName(entry: ActivityLogEntry): string | null {
  const d = entry.details as Record<string, unknown> | null
  if (!d) return null
  const n = d.entityName
  return typeof n === 'string' && n.length > 0 ? n : null
}

// ─── Diff-Darstellung ─────────────────────────────────────────────────────────

export interface DiffRow {
  label: string
  from: string
  to: string
}

export interface DetailRow {
  label: string
  value: string
}

/**
 * Liefert die Änderungen (falls `details.changes` vorhanden) als Diff-Zeilen.
 */
export function formatChanges(entry: ActivityLogEntry, t: TFunction): DiffRow[] {
  const d = entry.details as Record<string, unknown> | null
  const changes = d?.changes as Record<string, { from: unknown; to: unknown }> | undefined
  if (!changes || typeof changes !== 'object') return []
  const rows: DiffRow[] = []
  for (const [key, diff] of Object.entries(changes)) {
    if (!diff || typeof diff !== 'object') continue
    rows.push({
      label: labelForField(key, t),
      from: formatDiffValue(diff.from),
      to: formatDiffValue(diff.to),
    })
  }
  return rows
}

/**
 * Liefert zusätzliche Detail-Zeilen (keine Diffs) aus dem `details`-Objekt.
 * Bereinigt automatisch Rauschen: changes, entityName, payload etc.
 */
export function formatDetails(entry: ActivityLogEntry, t: TFunction): DetailRow[] {
  const d = entry.details as Record<string, unknown> | null
  if (!d) return []
  const rows: DetailRow[] = []

  // Created-Felder (bei POST)
  const created = d.created as Record<string, unknown> | undefined
  if (created && typeof created === 'object') {
    for (const [key, val] of Object.entries(created)) {
      if (val === null || val === undefined || val === '') continue
      rows.push({ label: labelForField(key, t), value: formatDiffValue(val) })
    }
  }

  // Rollen-Permissions
  if (Array.isArray(d.added) && d.added.length > 0) {
    rows.push({ label: t('activityLog.added', 'Hinzugefügt'), value: (d.added as string[]).join(', ') })
  }
  if (Array.isArray(d.removed) && d.removed.length > 0) {
    rows.push({ label: t('activityLog.removed', 'Entfernt'), value: (d.removed as string[]).join(', ') })
  }

  // Generische zusätzliche Felder
  const SKIP = new Set(['changes', 'entityName', 'payload', 'created', 'added', 'removed', 'configType', 'command'])
  for (const [key, val] of Object.entries(d)) {
    if (SKIP.has(key)) continue
    if (val === null || val === undefined || val === '') continue
    if (typeof val === 'object') continue
    rows.push({ label: labelForField(key, t), value: formatDiffValue(val) })
  }

  return rows
}

function formatDiffValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (Array.isArray(v)) {
    if (v.length === 0) return '—'
    if (v.every((x) => typeof x === 'string' && UUID_RE.test(x))) {
      return v.length === 1 ? '1 Eintrag' : `${v.length} Einträge`
    }
    return v.map((x) => formatDiffValue(x)).join(', ')
  }
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'string' && UUID_RE.test(v)) return v.slice(0, 8) + '…'
  return String(v)
}

function labelForField(key: string, t: TFunction): string {
  switch (key) {
    case 'name':          return t('common.name')
    case 'email':         return t('common.email')
    case 'projectNumber': return 'Projekt-Nr.'
    case 'description':   return t('common.description')
    case 'serialNumber':  return t('devices.serialNumber', 'Seriennummer')
    case 'street':        return 'Strasse'
    case 'zip':           return 'PLZ'
    case 'city':          return 'Ort'
    case 'country':       return 'Land'
    case 'latitude':      return 'Breite'
    case 'longitude':     return 'Länge'
    case 'contactName':   return 'Kontakt'
    case 'contactPhone':  return 'Telefon'
    case 'contactMobile': return 'Mobil'
    case 'contactEmail':  return 'E-Mail (Kontakt)'
    case 'hasHeatPump':   return t('anlagen.plantTypeHeatPump', 'Wärmepumpe')
    case 'hasBoiler':     return t('anlagen.plantTypeBoiler', 'Heizkessel')
    case 'deviceIds':     return t('nav.devices')
    case 'anlageIds':     return t('nav.anlagen')
    case 'userIds':       return t('nav.users')
    case 'groupIds':      return t('nav.groups')
    case 'permissionIds': return 'Berechtigungen'
    case 'isApproved':    return t('devices.register', 'Registriert')
    case 'notes':         return 'Notizen'
    case 'status':        return t('common.status')
    case 'title':         return 'Titel'
    case 'message':       return 'Nachricht'
    case 'action':        return 'Befehl'
    case 'command':       return 'Befehl'
    case 'firstName':     return 'Vorname'
    case 'lastName':      return 'Nachname'
    case 'roleId':        return t('common.role', 'Rolle')
    case 'roleName':      return t('common.role', 'Rolle')
    case 'isActive':      return t('common.active', 'Aktiv')
    case 'vpnIp':         return 'VPN-IP'
    case 'ipAddress':     return 'IP-Adresse'
    case 'address':       return 'Adresse'
    case 'remoteUser':    return 'Remote-User'
    case 'anlageName':    return t('activityLog.entity.anlage', 'Anlage')
    case 'required':      return 'Benötigt'
    case 'method':        return 'Methode'
    case 'path':          return 'Pfad'
    default:              return key
  }
}

/**
 * Icon-Zuordnung für den Action-Typ — gibt den Material-Icon-Namen zurück
 * (muss im Consumer importiert/gemappt werden).
 */
export function actionIconKey(action: string): string {
  if (action.startsWith('auth.login.failed')) return 'error'
  if (action === 'auth.login')      return 'login'
  if (action === 'auth.logout')     return 'logout'
  if (action === 'vpn.visu.open')   return 'visu'
  if (action === 'vpn.deploy')      return 'deploy'
  if (action.startsWith('vpn.config.download')) return 'download'
  if (action === 'permission.denied') return 'block'
  if (action === 'users.password.update') return 'password'
  if (action === 'roles.permissions.update') return 'security'
  if (action.startsWith('system.')) return 'system'
  if (action.startsWith('devices.command.')) return 'command'
  if (action.endsWith('.create'))   return 'add'
  if (action.endsWith('.update'))   return 'edit'
  if (action.endsWith('.delete'))   return 'delete'
  return 'info'
}

/**
 * Farbkategorie für den Action-Typ
 */
export function actionColor(action: string): 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info' {
  if (action === 'auth.login.failed' || action === 'permission.denied') return 'error'
  if (action === 'auth.login' || action === 'auth.logout') return 'info'
  if (action === 'vpn.visu.open') return 'info'
  if (action === 'vpn.deploy' || action.startsWith('vpn.config.download')) return 'warning'
  if (action === 'users.password.update' || action === 'roles.permissions.update') return 'warning'
  if (action.startsWith('system.')) return 'default'
  if (action.startsWith('devices.command.')) return 'info'
  if (action.endsWith('.delete')) return 'error'
  if (action.endsWith('.create')) return 'success'
  if (action.endsWith('.update')) return 'primary'
  return 'default'
}
