/**
 * Feiertags-Helpers – regel-basiert.
 *
 * Zwei Typen:
 *  - FIXED: festes Datum (MM-DD), z.B. Neujahr, Bundesfeier.
 *  - EASTER_OFFSET: Tage relativ zu Ostersonntag (negativ = davor).
 *
 * Osterdatum via Gauß-Osteralgorithmus.
 */

export type HolidayRuleType = 'FIXED' | 'EASTER_OFFSET'

export interface HolidayRuleDef {
  key: string
  label: string
  type: HolidayRuleType
  fixedMonth?: number
  fixedDay?: number
  easterOffset?: number
  region?: string
  sortOrder: number
}

/** Gauß-Osteralgorithmus – Ostersonntag als UTC-Date. */
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n))
}

/**
 * Standard-Regel-Set "Luzern". Wird beim Seed einmalig in die Datenbank
 * gespiegelt. Alle Regeln sind default `isActive=true`.
 */
export const LUZERN_HOLIDAY_RULES: HolidayRuleDef[] = [
  { key: 'neujahr',           label: 'Neujahr',            type: 'FIXED',         fixedMonth: 1,  fixedDay: 1,  region: 'CH', sortOrder: 10 },
  { key: 'berchtoldstag',     label: 'Berchtoldstag',      type: 'FIXED',         fixedMonth: 1,  fixedDay: 2,  region: 'LU', sortOrder: 20 },
  { key: 'karfreitag',        label: 'Karfreitag',         type: 'EASTER_OFFSET', easterOffset: -2, region: 'CH',             sortOrder: 30 },
  { key: 'ostermontag',       label: 'Ostermontag',        type: 'EASTER_OFFSET', easterOffset: 1,  region: 'CH',             sortOrder: 40 },
  { key: 'auffahrt',          label: 'Auffahrt',           type: 'EASTER_OFFSET', easterOffset: 39, region: 'CH',             sortOrder: 50 },
  { key: 'pfingstmontag',     label: 'Pfingstmontag',      type: 'EASTER_OFFSET', easterOffset: 50, region: 'CH',             sortOrder: 60 },
  { key: 'fronleichnam',      label: 'Fronleichnam',       type: 'EASTER_OFFSET', easterOffset: 60, region: 'LU',             sortOrder: 70 },
  { key: 'bundesfeier',       label: 'Bundesfeier',        type: 'FIXED',         fixedMonth: 8,  fixedDay: 1,  region: 'CH', sortOrder: 80 },
  { key: 'mariae_himmelfahrt',label: 'Mariä Himmelfahrt',  type: 'FIXED',         fixedMonth: 8,  fixedDay: 15, region: 'LU', sortOrder: 90 },
  { key: 'allerheiligen',     label: 'Allerheiligen',      type: 'FIXED',         fixedMonth: 11, fixedDay: 1,  region: 'LU', sortOrder: 100 },
  { key: 'mariae_empfaengnis',label: 'Mariä Empfängnis',   type: 'FIXED',         fixedMonth: 12, fixedDay: 8,  region: 'LU', sortOrder: 110 },
  { key: 'weihnachten',       label: 'Weihnachten',        type: 'FIXED',         fixedMonth: 12, fixedDay: 25, region: 'CH', sortOrder: 120 },
  { key: 'stephanstag',       label: 'Stephanstag',        type: 'FIXED',         fixedMonth: 12, fixedDay: 26, region: 'LU', sortOrder: 130 },
]

/** Konkretes Datum einer Regel für das gegebene Jahr. null wenn Daten ungültig. */
export function ruleToDate(
  rule: {
    type: HolidayRuleType
    fixedMonth?: number | null
    fixedDay?: number | null
    easterOffset?: number | null
  },
  year: number,
): Date | null {
  if (rule.type === 'FIXED') {
    if (rule.fixedMonth == null || rule.fixedDay == null) return null
    return new Date(Date.UTC(year, rule.fixedMonth - 1, rule.fixedDay))
  }
  if (rule.type === 'EASTER_OFFSET') {
    if (rule.easterOffset == null) return null
    return addDays(easterSunday(year), rule.easterOffset)
  }
  return null
}

/** YYYY-MM-DD Tageskey für lokale Tagesvergleiche. */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dayKeyUTC(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
