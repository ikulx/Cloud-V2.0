import { prisma } from '../db/prisma'
import { sendAlarmMail } from './mail.service'

/**
 * Alarm-Dispatcher
 * ─────────────────
 * Ablauf pro AlarmEvent:
 *
 *   1. Rate-Limit pro Anlage prüfen (globale Drosselung). Greift → ALLE
 *      Empfänger bekommen SKIPPED "rate_limited".
 *   2. Pro Empfänger:
 *        a) Prioritätsfilter → sonst kein Delivery-Eintrag.
 *        b) Wochenzeitplan zum EVENT-Zeitpunkt auswerten.
 *           - drin → Delivery PENDING mit scheduledAt = now + delayMinutes.
 *             Der Delivery-Worker nimmt sie bei Fälligkeit auf und versendet.
 *           - draussen → SKIPPED "out_of_schedule" (KEIN Nachholen).
 *        c) delayMinutes = 0 → Delivery wird direkt durchprozessiert.
 *
 *   3. Wenn der Pi den Alarm während der Verzögerung CLEARED, werden alle
 *      PENDING-Deliveries durch alarm-ingest.service beim Status-Wechsel
 *      auf SKIPPED "event_cleared" gesetzt und nicht mehr versendet.
 */

interface DispatchParams {
  eventId: string
}

// ── Zeitplan-Typ (normalisiertes Format) ────────────────────────────────────
export interface ScheduleWindow { start: string; end: string }
export interface ScheduleDay { enabled: boolean; windows: ScheduleWindow[] }
export interface RecipientSchedule {
  mode: 'always' | 'weekly'
  days?: ScheduleDay[]
}

/**
 * Nimmt eine ggf. legacy-geformte schedule-JSON und bringt sie ins neue
 * `windows[]`-Format. Legacy: `{ enabled, start, end }` pro Tag.
 * Rückgabe: null/undefined → gilt wie "always".
 */
export function normalizeSchedule(raw: unknown): RecipientSchedule | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (s.mode !== 'weekly') return { mode: 'always' }
  if (!Array.isArray(s.days)) return { mode: 'always' }

  const days: ScheduleDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = (s.days as unknown[])[i] as Record<string, unknown> | undefined
    const enabled = !!d?.enabled
    let windows: ScheduleWindow[] = []
    if (d && Array.isArray(d.windows)) {
      windows = (d.windows as unknown[])
        .map((w) => w as Record<string, unknown>)
        .filter((w) => typeof w?.start === 'string' && typeof w?.end === 'string')
        .map((w) => ({ start: w.start as string, end: w.end as string }))
    } else if (d && typeof d.start === 'string' && typeof d.end === 'string') {
      // Legacy: ein Fenster pro Tag
      windows = [{ start: d.start, end: d.end }]
    }
    days.push({ enabled, windows })
  }
  return { mode: 'weekly', days }
}

/** Prüft, ob `now` im Zeitplan liegt. `null`/leer → immer true. */
export function isInSchedule(raw: unknown, now: Date): boolean {
  const s = normalizeSchedule(raw)
  if (!s || s.mode !== 'weekly') return true
  if (!s.days || s.days.length !== 7) return true

  // JS Date.getDay(): 0=Sonntag ... 6=Samstag. Intern nutzen wir 0=Montag.
  const jsDay = now.getDay()
  const idx = jsDay === 0 ? 6 : jsDay - 1
  const d = s.days[idx]
  if (!d.enabled || d.windows.length === 0) return false

  const cur = now.getHours() * 60 + now.getMinutes()
  for (const w of d.windows) {
    const [sH, sM] = String(w.start ?? '00:00').split(':').map(Number)
    const [eH, eM] = String(w.end   ?? '23:59').split(':').map(Number)
    if (![sH, sM, eH, eM].every((n) => Number.isFinite(n))) continue
    const start = sH * 60 + sM
    const end   = eH * 60 + eM
    if (end >= start) {
      if (cur >= start && cur <= end) return true
    } else {
      // Fenster über Mitternacht
      if (cur >= start || cur <= end) return true
    }
  }
  return false
}

export async function dispatchAlarmEvent({ eventId }: DispatchParams): Promise<void> {
  const event = await prisma.alarmEvent.findUnique({
    where: { id: eventId },
    include: {
      anlage: {
        select: {
          id: true,
          alarmRateLimitMinutes: true,
          alarmRecipients: {
            where: { isActive: true },
            // Template wird geladen, damit der Dispatcher bei internen
            // Empfängern die aktuelle E-Mail-Adresse aus dem Template nutzt.
            include: { template: { select: { email: true, label: true } } } as never,
          },
        },
      },
    },
  })
  if (!event) {
    console.warn(`[AlarmDispatcher] Event ${eventId} nicht gefunden`)
    return
  }
  if (!event.anlage) {
    console.warn(`[AlarmDispatcher] Event ${eventId} hat keine Anlage – kein Versand`)
    return
  }

  const anlage = event.anlage
  const now = new Date()

  // ── 1. Rate-Limit-Check pro Anlage ────────────────────────────────────
  const limitMin = Math.max(0, anlage.alarmRateLimitMinutes ?? 60)
  let rateLimited = false
  if (limitMin > 0) {
    const windowStart = new Date(now.getTime() - limitMin * 60 * 1000)
    const recentSent = await prisma.alarmEventDelivery.findFirst({
      where: {
        status: 'SENT',
        sentAt: { gte: windowStart },
        event: { anlageId: anlage.id },
        NOT: { eventId: event.id },
      },
      select: { id: true },
    })
    if (recentSent) {
      rateLimited = true
      console.log(`[AlarmDispatcher] Event ${eventId} rate-limited (${limitMin} min Fenster)`)
    }
  }

  // ── 2. Empfänger durchgehen ──────────────────────────────────────────
  const matching = anlage.alarmRecipients.filter((r) => {
    if (r.priorities.length === 0) return true
    return r.priorities.includes(event.priority)
  })

  if (matching.length === 0) {
    console.log(`[AlarmDispatcher] Event ${eventId} (${event.priority}) – keine passenden Empfänger`)
    return
  }

  const immediateIds: string[] = []

  for (const r of matching) {
    // Adresse auflösen: bei Template-basierten Empfängern (templateId gesetzt)
    // aus dem zentralen Template, sonst direkt aus `target`. `isInternal` ist
    // nur eine Sichtbarkeits-Markierung und beeinflusst die Adresse nicht.
    const rAny = r as unknown as {
      templateId?: string | null
      template?: { email: string | null } | null
    }
    const effectiveTarget = rAny.templateId
      ? (rAny.template?.email ?? '').trim()
      : (r.target ?? '').trim()
    if (!effectiveTarget) {
      const reason = rAny.templateId ? 'template_email_missing' : 'target_missing'
      await prisma.alarmEventDelivery.create({
        data: {
          eventId: event.id, recipientId: r.id, type: r.type, target: '',
          status: 'SKIPPED', errorMessage: reason, attemptedAt: now,
        },
      })
      continue
    }

    if (rateLimited) {
      await prisma.alarmEventDelivery.create({
        data: {
          eventId: event.id, recipientId: r.id, type: r.type, target: effectiveTarget,
          status: 'SKIPPED', errorMessage: 'rate_limited', attemptedAt: now,
        },
      })
      continue
    }

    // Wochenplan jetzt prüfen – wenn ausserhalb, definitiv verwerfen.
    if (!isInSchedule(r.schedule, now)) {
      await prisma.alarmEventDelivery.create({
        data: {
          eventId: event.id, recipientId: r.id, type: r.type, target: effectiveTarget,
          status: 'SKIPPED', errorMessage: 'out_of_schedule', attemptedAt: now,
        },
      })
      continue
    }

    // Zeitplan ok → Delivery für scheduledAt planen (= now + delayMinutes).
    const delay = Math.max(0, r.delayMinutes ?? 0)
    const scheduledAt = new Date(now.getTime() + delay * 60_000)
    const delivery = await prisma.alarmEventDelivery.create({
      data: {
        eventId: event.id, recipientId: r.id, type: r.type, target: effectiveTarget,
        status: 'PENDING', scheduledAt,
      } as never,
    })
    if (delay === 0) immediateIds.push(delivery.id)
    else console.log(`[AlarmDispatcher] Delivery ${delivery.id} geplant für ${scheduledAt.toISOString()} (+${delay} min)`)
  }

  // Sofort-Fälligkeiten (delay = 0) direkt abarbeiten statt auf den Worker zu warten.
  if (immediateIds.length > 0) {
    void processDueDeliveries(immediateIds).catch((err) => {
      console.error('[AlarmDispatcher] Sofort-Versand fehlgeschlagen:', err)
    })
  }
}

// ── Delivery-Worker ─────────────────────────────────────────────────────────
// Ausgeführt vom alarm-delivery-worker.service (setInterval). Kann hier mit
// einer expliziten ID-Liste oder ohne (alle fälligen) aufgerufen werden.

export async function processDueDeliveries(onlyIds?: string[]): Promise<void> {
  const now = new Date()
  const where = onlyIds
    ? { id: { in: onlyIds }, status: 'PENDING' as const }
    : { status: 'PENDING' as const, scheduledAt: { lte: now } }

  // Casts wegen stale lokalem Prisma-Client (scheduledAt neu im Schema);
  // Docker-Build regeneriert korrekt.
  type DueDelivery = {
    id: string
    type: string
    target: string
    event: {
      status: string
      priority: string
      message: string
      source: string | null
      activatedAt: Date
      device: { name: string; serialNumber: string }
      anlage: { name: string; projectNumber: string | null } | null
    }
  }
  const due = (await prisma.alarmEventDelivery.findMany({
    where: where as never,
    orderBy: { scheduledAt: 'asc' } as never,
    take: 100,
    include: {
      event: {
        include: {
          device: { select: { name: true, serialNumber: true } },
          anlage: { select: { name: true, projectNumber: true } },
        },
      },
    },
  })) as unknown as DueDelivery[]

  for (const d of due) {
    try {
      // Event-Status zum Versand-Zeitpunkt prüfen: wurde es inzwischen
      // vom Pi zurückgenommen? Dann Eskalation unterdrücken.
      if (d.event.status !== 'ACTIVE') {
        await prisma.alarmEventDelivery.update({
          where: { id: d.id },
          data: { status: 'SKIPPED', errorMessage: 'event_cleared', attemptedAt: now },
        })
        continue
      }

      // Transport
      if (d.type === 'EMAIL') {
        try {
          await sendAlarmMail(d.target, {
            priority: d.event.priority,
            message: d.event.message,
            anlageName: d.event.anlage?.name ?? '—',
            projectNumber: d.event.anlage?.projectNumber ?? null,
            deviceName: d.event.device.name,
            serial: d.event.device.serialNumber,
            activatedAt: d.event.activatedAt,
            source: d.event.source,
          })
          await prisma.alarmEventDelivery.update({
            where: { id: d.id },
            data: { status: 'SENT', sentAt: new Date(), attemptedAt: now },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[AlarmDispatcher] Versand an ${d.target} fehlgeschlagen:`, msg)
          await prisma.alarmEventDelivery.update({
            where: { id: d.id },
            data: { status: 'FAILED', errorMessage: msg.slice(0, 500), attemptedAt: now },
          })
        }
      } else if (d.type === 'SMS') {
        await prisma.alarmEventDelivery.update({
          where: { id: d.id },
          data: { status: 'SKIPPED', errorMessage: 'sms_transport_not_configured', attemptedAt: now },
        })
      } else if (d.type === 'TELEGRAM') {
        await prisma.alarmEventDelivery.update({
          where: { id: d.id },
          data: { status: 'SKIPPED', errorMessage: 'telegram_transport_not_configured', attemptedAt: now },
        })
      }
    } catch (err) {
      console.error(`[AlarmDispatcher] Fehler in processDueDeliveries für ${d.id}:`, err)
    }
  }
}
