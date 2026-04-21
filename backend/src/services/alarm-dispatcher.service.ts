import { prisma } from '../db/prisma'
import { sendAlarmMail } from './mail.service'

/**
 * Alarm-Dispatcher
 * ─────────────────
 * Nimmt ein fertiges AlarmEvent (bereits in der DB) und versendet
 * Benachrichtigungen an alle konfigurierten Empfänger der Anlage.
 *
 * Aktuell implementiert: Email (nodemailer via mail.service).
 * SMS / Telegram sind als Stubs vorhanden – Datenmodell ist vollständig,
 * Transport kommt später.
 */

interface DispatchParams {
  eventId: string
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

  const recipients = event.anlage.alarmRecipients.filter((r) => {
    // Leere Prioritätsliste = alle Prioritäten.
    if (r.priorities.length === 0) return true
    return r.priorities.includes(event.priority)
  })

  if (recipients.length === 0) {
    console.log(`[AlarmDispatcher] Event ${eventId} (${event.priority}) – keine passenden Empfänger`)
    return
  }

  console.log(`[AlarmDispatcher] Event ${eventId} → ${recipients.length} Empfänger`)

  for (const r of recipients) {
    // Delivery-Row anlegen bevor wir senden, damit auch Fehler protokolliert werden.
    const delivery = await prisma.alarmEventDelivery.create({
      data: {
        eventId: event.id,
        recipientId: r.id,
        type: r.type,
        target: r.target,
        status: 'PENDING',
        attemptedAt: new Date(),
      },
    })

    try {
      if (r.type === 'EMAIL') {
        await sendAlarmMail(r.target, {
          priority: event.priority,
          message: event.message,
          anlageName: event.anlage.name,
          projectNumber: event.anlage.projectNumber,
          deviceName: event.device.name,
          serial: event.device.serialNumber,
          activatedAt: event.activatedAt,
          source: event.source,
        })
      } else if (r.type === 'SMS') {
        // TODO Transport implementieren (Twilio o.ä.)
        console.warn(`[AlarmDispatcher] SMS noch nicht implementiert – übersprungen (${r.target})`)
        await prisma.alarmEventDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SKIPPED', errorMessage: 'SMS-Transport nicht konfiguriert' },
        })
        continue
      } else if (r.type === 'TELEGRAM') {
        // TODO Telegram-Bot implementieren
        console.warn(`[AlarmDispatcher] Telegram noch nicht implementiert – übersprungen (${r.target})`)
        await prisma.alarmEventDelivery.update({
          where: { id: delivery.id },
          data: { status: 'SKIPPED', errorMessage: 'Telegram-Transport nicht konfiguriert' },
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
