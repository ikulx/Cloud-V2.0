import { prisma } from '../db/prisma'
import { sendAlarmMail } from './mail.service'

/**
 * Alarm-Dispatcher
 * ─────────────────
 * Nimmt ein fertiges AlarmEvent (bereits in der DB) und versendet
 * Benachrichtigungen an alle konfigurierten Empfänger der Anlage.
 *
 * Regeln:
 *  - Rate-Limit pro Anlage (default 60 min): Wenn innerhalb des Fensters
 *    bereits eine SENT-Delivery eines anderen Events derselben Anlage
 *    existiert, werden alle Deliveries dieses Events als SKIPPED markiert
 *    (rate_limited).
 *  - Wochenzeitplan pro Empfänger: Empfänger werden nur bedient, wenn der
 *    aktuelle Zeitpunkt im Zeitplan liegt. Ausserhalb → SKIPPED
 *    (out_of_schedule), KEIN Nachholen.
 *  - Prioritätsfilter pro Empfänger: leere Liste = alle Prioritäten.
 *
 * Transport: Email via nodemailer/mail.service. SMS/Telegram → Stubs.
 */

interface DispatchParams {
  eventId: string
}

// ── Zeitplan-Typ (deckt sich mit dem JSON-Schema in Prisma) ─────────────────
export interface RecipientSchedule {
  mode: 'always' | 'weekly'
  days?: Array<{ enabled: boolean; start: string; end: string }>
}

/**
 * Prüft, ob `now` im Zeitplan liegt. `null`/leer → immer true.
 * Tagesindex: 0 = Montag … 6 = Sonntag.
 */
export function isInSchedule(schedule: unknown, now: Date): boolean {
  if (!schedule || typeof schedule !== 'object') return true
  const s = schedule as RecipientSchedule
  if (s.mode !== 'weekly') return true
  if (!Array.isArray(s.days) || s.days.length !== 7) return true

  // JS Date.getDay(): 0=Sonntag … 6=Samstag. Intern nutzen wir 0=Montag.
  const jsDay = now.getDay()
  const idx = jsDay === 0 ? 6 : jsDay - 1
  const d = s.days[idx]
  if (!d || !d.enabled) return false

  const [sH, sM] = String(d.start ?? '00:00').split(':').map(Number)
  const [eH, eM] = String(d.end   ?? '23:59').split(':').map(Number)
  if ([sH, sM, eH, eM].some((n) => !Number.isFinite(n))) return true

  const cur = now.getHours() * 60 + now.getMinutes()
  const start = sH * 60 + sM
  const end   = eH * 60 + eM

  if (end >= start) return cur >= start && cur <= end
  // Über Mitternacht, z.B. 22:00–06:00
  return cur >= start || cur <= end
}

export async function dispatchAlarmEvent({ eventId }: DispatchParams): Promise<void> {
  const event = await prisma.alarmEvent.findUnique({
    where: { id: eventId },
    include: {
      device: { select: { name: true, serialNumber: true } },
      anlage: {
        select: {
          id: true,
          name: true,
          projectNumber: true,
          alarmRateLimitMinutes: true,
          alarmRecipients: { where: { isActive: true } },
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

  // ── Rate-Limit-Check pro Anlage ────────────────────────────────────────
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
      select: { id: true, sentAt: true },
    })
    if (recentSent) {
      rateLimited = true
      console.log(
        `[AlarmDispatcher] Event ${eventId} rate-limited ` +
        `(Anlage ${anlage.name}: ${limitMin} min Fenster, letzter Versand ${recentSent.sentAt?.toISOString()})`,
      )
    }
  }

  // Zielmenge der Empfänger nach Prioritätsfilter
  const matching = anlage.alarmRecipients.filter((r) => {
    if (r.priorities.length === 0) return true
    return r.priorities.includes(event.priority)
  })

  if (matching.length === 0) {
    console.log(`[AlarmDispatcher] Event ${eventId} (${event.priority}) – keine passenden Empfänger`)
    return
  }

  for (const r of matching) {
    // Delivery-Row anlegen – auch für geskippte, damit die Historie vollständig
    // bleibt und der UI-User sehen kann, warum ein Empfänger nicht bedient wurde.
    const delivery = await prisma.alarmEventDelivery.create({
      data: {
        eventId: event.id,
        recipientId: r.id,
        type: r.type,
        target: r.target,
        status: 'PENDING',
        attemptedAt: now,
      },
    })

    // 1. Rate-Limit: für alle Empfänger identisch
    if (rateLimited) {
      await prisma.alarmEventDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SKIPPED', errorMessage: 'rate_limited' },
      })
      continue
    }

    // 2. Wochenzeitplan pro Empfänger
    if (!isInSchedule(r.schedule, now)) {
      await prisma.alarmEventDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SKIPPED', errorMessage: 'out_of_schedule' },
      })
      continue
    }

    // 3. Transport
    try {
      if (r.type === 'EMAIL') {
        await sendAlarmMail(r.target, {
          priority: event.priority,
          message: event.message,
          anlageName: anlage.name,
          projectNumber: anlage.projectNumber,
          deviceName: event.device.name,
          serial: event.device.serialNumber,
          activatedAt: event.activatedAt,
          source: event.source,
        })
      } else if (r.type === 'SMS') {
        await prisma.alarmEventDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SKIPPED', errorMessage: 'sms_transport_not_configured' },
        })
        continue
      } else if (r.type === 'TELEGRAM') {
        await prisma.alarmEventDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SKIPPED', errorMessage: 'telegram_transport_not_configured' },
        })
        continue
      }

      await prisma.alarmEventDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', sentAt: new Date() },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[AlarmDispatcher] Versand an ${r.target} fehlgeschlagen:`, msg)
      await prisma.alarmEventDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', errorMessage: msg.slice(0, 500) },
      })
    }
  }
}
