import type { TFunction } from 'i18next'
import type { ActivityLogEntry } from '../features/activity-log/queries'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Menschenlesbare Bezeichnung für einen Entity-Typ (z.B. "anlagen" → "Anlage") */
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
    'activity-log': t('activityLog.title', 'Aktivitätslog'),
    me:          t('activityLog.entity.user', 'Benutzer'),
    todos:       t('activityLog.entity.todo', 'Todo'),
    todo:        t('activityLog.entity.todo', 'Todo'),
    logs:        t('activityLog.entity.log', 'Logbuch-Eintrag'),
    log:         t('activityLog.entity.log', 'Logbuch-Eintrag'),
    peers:       t('activityLog.entity.peer', 'VPN-Peer'),
    'lan-devices': t('activityLog.entity.lanDevice', 'LAN-Gerät'),
    'lan-device':  t('activityLog.entity.lanDevice', 'LAN-Gerät'),
    command:     t('activityLog.entity.command', 'Befehl'),
    deploy:      t('activityLog.entity.deploy', 'VPN-Deploy'),
    approve:     t('activityLog.entity.approve', 'Registrierung'),
    enable:      t('activityLog.entity.enable', 'VPN aktiviert'),
    disable:     t('activityLog.entity.disable', 'VPN deaktiviert'),
    visu:        t('activityLog.entity.visu', 'Visu'),
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
 * Wandelt eine rohe Activity-Action in einen lesbaren Titel um.
 * Zusätzlich wird das "Hauptentität" im Titel gezeigt wenn eine Sub-Ressource
 * modifiziert wurde (z.B. "Todo bearbeitet · in Anlage").
 */
export function formatActionTitle(entry: ActivityLogEntry, t: TFunction): string {
  const a = entry.action ?? ''

  // Spezialfälle Auth-Events
  if (a === 'auth.login')        return t('activityLog.action.login', 'Anmeldung')
  if (a === 'auth.login.failed') return t('activityLog.action.loginFailed', 'Fehlgeschlagene Anmeldung')
  if (a === 'auth.logout')       return t('activityLog.action.logout', 'Abmeldung')

  const segments = a.split('.')
  const verb = segments[segments.length - 1]
  const entityParts = segments.slice(0, -1).filter((p) => !UUID_RE.test(p))

  if (entityParts.length === 0) {
    return `? ${verbLabel(verb, t)}`
  }

  if (entityParts.length === 1) {
    return `${entityLabel(entityParts[0], t)} ${verbLabel(verb, t)}`
  }

  // Sub-Ressource: z.B. "anlagen.todos.create" → "Todo erstellt · in Anlage"
  const parent = entityParts[0]
  const sub = entityParts[entityParts.length - 1]
  const parentLabel = entityLabel(parent, t)
  const subLabel = entityLabel(sub, t)
  const contextLabel = t('activityLog.contextPrefix', 'in')
  return `${subLabel} ${verbLabel(verb, t)} · ${contextLabel} ${parentLabel}`
}

/**
 * Formatiert die Details als lesbare Liste. UUIDs werden als kompakte Kurzform angezeigt.
 */
export function formatDetails(entry: ActivityLogEntry, t: TFunction): Array<{ label: string; value: string }> {
  if (!entry.details) return []
  const result: Array<{ label: string; value: string }> = []
  for (const [key, val] of Object.entries(entry.details)) {
    if (val === null || val === undefined || val === '') continue
    const label = labelForField(key, t)
    if (Array.isArray(val)) {
      if (val.length === 0) continue
      // ID-Arrays zusammenfassen, ohne UUIDs im Detail
      if (val.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
        result.push({ label, value: t('activityLog.itemCount', '{{count}} Einträge', { count: val.length }) })
      } else {
        result.push({ label, value: val.map((v) => formatValue(v)).join(', ') })
      }
    } else if (typeof val === 'object') {
      // Objekte überspringen (zu komplex für eine Zeile)
      continue
    } else {
      const strVal = formatValue(val)
      // UUIDs als Wert abkürzen
      if (typeof val === 'string' && UUID_RE.test(val)) {
        result.push({ label, value: strVal.slice(0, 8) + '…' })
      } else {
        result.push({ label, value: strVal })
      }
    }
  }
  return result
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (v === null || v === undefined) return '—'
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
    case 'isApproved':    return t('devices.register', 'Registriert')
    case 'notes':         return 'Notizen'
    case 'status':        return t('common.status')
    case 'title':         return 'Titel'
    case 'message':       return 'Nachricht'
    case 'action':        return 'Befehl'
    case 'firstName':     return 'Vorname'
    case 'lastName':      return 'Nachname'
    case 'roleId':        return t('common.role', 'Rolle')
    case 'isActive':      return t('common.active', 'Aktiv')
    default:              return key
  }
}
