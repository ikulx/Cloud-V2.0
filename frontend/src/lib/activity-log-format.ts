import type { TFunction } from 'i18next'
import type { ActivityLogEntry } from '../features/activity-log/queries'

/**
 * Wandelt eine rohe Activity-Action in einen lesbaren Titel um.
 * Fallback: Action-String wie "anlagen.create" wird als ist angezeigt.
 */
export function formatActionTitle(entry: ActivityLogEntry, t: TFunction): string {
  const a = entry.action
  // Auth-Events
  if (a === 'auth.login')        return t('activityLog.action.login', 'Anmeldung')
  if (a === 'auth.login.failed') return t('activityLog.action.loginFailed', 'Fehlgeschlagene Anmeldung')
  if (a === 'auth.logout')       return t('activityLog.action.logout', 'Abmeldung')

  // Generische Entity-Actions
  const [entity, verb, subverb] = a.split('.')
  const verbText = verb === 'create' ? t('activityLog.verb.create', 'erstellt')
                 : verb === 'update' ? t('activityLog.verb.update', 'bearbeitet')
                 : verb === 'delete' ? t('activityLog.verb.delete', 'gelöscht')
                 : verb ?? ''
  const entityLabel = entityLabelFor(entity, t)

  if (subverb) {
    // Sub-Resources wie anlagen.todos.create
    const subEntity = verb
    const actualVerb = subverb
    const subVerbText = actualVerb === 'create' ? t('activityLog.verb.create', 'erstellt')
                     : actualVerb === 'update' ? t('activityLog.verb.update', 'bearbeitet')
                     : actualVerb === 'delete' ? t('activityLog.verb.delete', 'gelöscht')
                     : actualVerb
    const subLabel = subEntityLabelFor(subEntity, t)
    return `${subLabel} ${subVerbText} (${entityLabelFor(entity, t)})`
  }

  return `${entityLabel} ${verbText}`
}

function entityLabelFor(entity: string, t: TFunction): string {
  switch (entity) {
    case 'anlagen':       return t('activityLog.entity.anlage', 'Anlage')
    case 'devices':       return t('activityLog.entity.device', 'Gerät')
    case 'users':         return t('activityLog.entity.user', 'Benutzer')
    case 'groups':        return t('activityLog.entity.group', 'Gruppe')
    case 'roles':         return t('activityLog.entity.role', 'Rolle')
    case 'vpn':           return t('activityLog.entity.vpn', 'VPN')
    case 'settings':      return t('activityLog.entity.settings', 'Einstellungen')
    case 'invitations':   return t('activityLog.entity.invitation', 'Einladung')
    case 'permissions':   return t('activityLog.entity.permission', 'Permission')
    default:              return entity
  }
}

function subEntityLabelFor(sub: string, t: TFunction): string {
  switch (sub) {
    case 'todos':         return t('activityLog.entity.todo', 'Todo')
    case 'logs':          return t('activityLog.entity.log', 'Logbuch-Eintrag')
    default:              return sub
  }
}

/**
 * Formatiert die Details als Key-Value-Liste. Gibt ein Array zurück, damit
 * die UI sie sinnvoll rendern kann.
 */
export function formatDetails(entry: ActivityLogEntry, t: TFunction): Array<{ label: string; value: string }> {
  if (!entry.details) return []
  const result: Array<{ label: string; value: string }> = []
  for (const [key, val] of Object.entries(entry.details)) {
    if (val === null || val === undefined || val === '') continue
    // Arrays kürzen
    if (Array.isArray(val)) {
      if (val.length === 0) continue
      result.push({ label: labelForField(key, t), value: `${val.length}× ${formatValue(val[0])}${val.length > 1 ? ` …` : ''}` })
    } else if (typeof val === 'object') {
      result.push({ label: labelForField(key, t), value: JSON.stringify(val) })
    } else {
      result.push({ label: labelForField(key, t), value: formatValue(val) })
    }
  }
  return result
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? '✓' : '✗'
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
    default:              return key
  }
}
