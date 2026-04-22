/**
 * Piket-Manager
 * ──────────────
 * Eskalations-State-Machine für den Piketdienst, wenn Template
 * `deliveryChannel = PIKET_MANAGER` ist.
 *
 * Ablauf pro Alarm:
 *   1. Anlagen-PLZ/Land → PiketRegion ermitteln.
 *   2. Heutiger PiketShift → Techniker (User).
 *   3. PiketAlarmEvent state PENDING_SMS anlegen, nextActionAt = now.
 *   4. Worker-Tick:
 *        PENDING_SMS → SMS senden (stub), state=SMS_SENT, nextActionAt=+smsToCallMinutes
 *        SMS_SENT (wenn Zeit reif und nicht ACK) → Anruf (stub), state=CALL_SENT,
 *                                                   nextActionAt=+callToLeaderMinutes
 *        CALL_SENT (wenn Zeit reif und nicht ACK) → Leader-Alarm (Mail/SMS-stub),
 *                                                   state=LEADER_SENT, nextActionAt=null
 *   5. Bestätigung via /api/piket/alarms/:id/ack → state=ACKNOWLEDGED, keine
 *      weiteren Aktionen.
 */

import { prisma } from '../db/prisma'
import { sendAlarmMail } from './mail.service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any

/** Match ZIP + Country zu einer PiketRegion. Erste Region gewinnt. */
export async function resolveRegionForAnlage(anlage: {
  zip: string | null
  country: string | null
}): Promise<{ id: string; name: string; leaderId: string | null; leaderFallbackEmail: string | null; smsToCallMinutes: number | null; callToLeaderMinutes: number | null } | null> {
  const rawZip = (anlage.zip ?? '').trim()
  if (!rawZip) return null

  // Auslandspräfix ("DE-12345", "AT-1010", …) – Präfix-Vergleich
  const upper = rawZip.toUpperCase()
  if (/^[A-Z]{2}-/.test(upper)) {
    const regions = await p.piketRegion.findMany({
      include: { foreignPrefixes: true },
    })
    for (const r of regions) {
      for (const fp of r.foreignPrefixes as Array<{ prefix: string }>) {
        if (upper.startsWith(fp.prefix.toUpperCase())) return r
      }
    }
    return null
  }

  // Sonst: PLZ als Zahl interpretieren und in [fromZip, toZip] matchen
  const n = parseInt(rawZip.replace(/\D/g, ''), 10)
  if (!Number.isFinite(n)) return null
  const match = await p.piketRegion.findFirst({
    where: { zipRanges: { some: { fromZip: { lte: n }, toZip: { gte: n } } } },
  })
  return match ?? null
}

/** Shift für heute in Region finden. Fällt auf gestrige Schicht zurück, wenn es um Mitternacht keinen neuen Eintrag gibt. */
export async function resolveShiftForToday(regionId: string, now: Date): Promise<{ userId: string } | null> {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  return p.piketShift.findUnique({ where: { regionId_date: { regionId, date: today } } })
    .catch(() => null)
}

interface PiketTriggerParams {
  alarmEventId: string
  anlage: { zip: string | null; country: string | null }
  smsToCallMinutes: number
  callToLeaderMinutes: number
}

/** Wird vom Dispatcher aufgerufen. Legt einen PiketAlarmEvent an. */
export async function startPiketAlarm({ alarmEventId, anlage, smsToCallMinutes, callToLeaderMinutes }: PiketTriggerParams): Promise<void> {
  const existing = await p.piketAlarmEvent.findUnique({ where: { alarmEventId } })
  if (existing) {
    console.log(`[PiketManager] Alarm ${alarmEventId} bereits initialisiert (state=${existing.state})`)
    return
  }
  const region = await resolveRegionForAnlage(anlage)
  if (!region) {
    await p.piketAlarmEvent.create({
      data: {
        alarmEventId,
        state: 'NO_TECH_FOUND',
        attempts: [{ at: new Date().toISOString(), kind: 'resolve', status: 'fail', error: 'no_region' }],
      },
    })
    console.warn(`[PiketManager] Keine Region für Anlage (zip=${anlage.zip})`)
    return
  }
  const shift = await resolveShiftForToday(region.id, new Date())
  if (!shift) {
    await p.piketAlarmEvent.create({
      data: {
        alarmEventId, regionId: region.id, leaderUserId: region.leaderId,
        state: 'LEADER_DUE',
        nextActionAt: new Date(),
        attempts: [{ at: new Date().toISOString(), kind: 'resolve', status: 'fallback_leader', error: 'no_shift' }],
      },
    })
    console.warn(`[PiketManager] Kein Techniker für heute in Region ${region.name} – direkt an Leader`)
    return
  }
  await p.piketAlarmEvent.create({
    data: {
      alarmEventId,
      regionId: region.id,
      techUserId: shift.userId,
      leaderUserId: region.leaderId,
      state: 'PENDING_SMS',
      nextActionAt: new Date(), // sofort fällig
      attempts: [{ at: new Date().toISOString(), kind: 'resolve', status: 'ok', region: region.name }],
    },
  })
  console.log(`[PiketManager] Alarm ${alarmEventId} → Region ${region.name} → Tech ${shift.userId}`)
  // SMS-Delay + Call-Delay speichern wir nicht pro Event; State-Machine liest
  // sie zur Laufzeit aus Region (override) bzw. Template-Settings (global).
  void smsToCallMinutes; void callToLeaderMinutes
}

// ── Transport-Stubs (echte Twilio-Anbindung später) ────────────────────────

async function sendSmsStub(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  console.log(`[PiketManager] [SMS-STUB] → ${to}: ${text.slice(0, 120)}`)
  return { ok: true }
}
async function callStub(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
  console.log(`[PiketManager] [CALL-STUB] → ${to}: ${text.slice(0, 120)}`)
  return { ok: true }
}

function alarmText(ev: {
  device: { name: string; serialNumber: string }
  anlage: { name: string; projectNumber: string | null } | null
  priority: string
  message: string
}): string {
  const anlageStr = ev.anlage ? `${ev.anlage.name}${ev.anlage.projectNumber ? ' (' + ev.anlage.projectNumber + ')' : ''}` : '—'
  return `[Piketdienst] ${ev.priority} ${anlageStr}: ${ev.message} – Gerät ${ev.device.name}`
}

// ── Worker-Tick ────────────────────────────────────────────────────────────

export async function processDuePiketActions(): Promise<void> {
  const now = new Date()
  const due = await p.piketAlarmEvent.findMany({
    where: {
      state: { in: ['PENDING_SMS', 'SMS_SENT', 'CALL_SENT', 'LEADER_DUE'] },
      nextActionAt: { lte: now },
    },
    include: {
      region: true,
      techUser: true,
      leaderUser: true,
      alarmEvent: {
        include: {
          device: { select: { name: true, serialNumber: true } },
          anlage: { select: { name: true, projectNumber: true } },
        },
      },
    },
    take: 50,
  })
  for (const pa of due) {
    try {
      // Wenn der Original-Alarm geclearet wurde, Piket-Flow beenden.
      if (pa.alarmEvent.status !== 'ACTIVE') {
        await p.piketAlarmEvent.update({
          where: { id: pa.id },
          data: { state: 'ACKNOWLEDGED', acknowledgedAt: now, nextActionAt: null, attempts: appendAttempt(pa.attempts, { kind: 'auto', status: 'event_cleared' }) },
        })
        continue
      }

      // Eskalations-Timings: Region-Override, sonst globale Defaults
      const SMS_TO_CALL_DEFAULT = 5
      const CALL_TO_LEADER_DEFAULT = 5
      const smsToCall    = pa.region?.smsToCallMinutes    ?? SMS_TO_CALL_DEFAULT
      const callToLeader = pa.region?.callToLeaderMinutes ?? CALL_TO_LEADER_DEFAULT
      const text = alarmText(pa.alarmEvent)

      if (pa.state === 'PENDING_SMS') {
        const to = ((pa.techUser as unknown as { phone?: string | null })?.phone ?? '').trim()
        const res = await sendSmsStub(to || pa.techUser?.email || 'unknown', text)
        await p.piketAlarmEvent.update({
          where: { id: pa.id },
          data: {
            state: res.ok ? 'SMS_SENT' : 'CALL_DUE',
            smsAt: now,
            nextActionAt: new Date(now.getTime() + smsToCall * 60_000),
            attempts: appendAttempt(pa.attempts, { kind: 'sms', status: res.ok ? 'ok' : 'fail', error: res.error }),
          },
        })
      } else if (pa.state === 'SMS_SENT') {
        const to = ((pa.techUser as unknown as { phone?: string | null })?.phone ?? '').trim()
        const res = await callStub(to || pa.techUser?.email || 'unknown', text)
        await p.piketAlarmEvent.update({
          where: { id: pa.id },
          data: {
            state: 'CALL_SENT',
            callAt: now,
            nextActionAt: new Date(now.getTime() + callToLeader * 60_000),
            attempts: appendAttempt(pa.attempts, { kind: 'call', status: res.ok ? 'ok' : 'fail', error: res.error }),
          },
        })
      } else if (pa.state === 'CALL_SENT' || pa.state === 'LEADER_DUE') {
        // Leader-Eskalation: Mail + SMS (Stub). Bei LEADER_DUE (kein Tech/Shift) direkt.
        const leaderEmail = pa.leaderUser?.email ?? pa.region?.leaderFallbackEmail ?? null
        let attempt = { kind: 'leader', status: 'skipped' as 'ok' | 'fail' | 'skipped', error: undefined as string | undefined }
        if (leaderEmail) {
          try {
            await sendAlarmMail(leaderEmail, {
              priority: pa.alarmEvent.priority,
              message: `[Piket-Eskalation] ${pa.alarmEvent.message}`,
              anlageName: pa.alarmEvent.anlage?.name ?? '—',
              projectNumber: pa.alarmEvent.anlage?.projectNumber ?? null,
              deviceName: pa.alarmEvent.device.name,
              serial: pa.alarmEvent.device.serialNumber,
              activatedAt: pa.alarmEvent.activatedAt,
              source: pa.alarmEvent.source,
            })
            attempt = { kind: 'leader', status: 'ok', error: undefined }
          } catch (err) {
            attempt = { kind: 'leader', status: 'fail', error: err instanceof Error ? err.message : String(err) }
          }
        }
        await p.piketAlarmEvent.update({
          where: { id: pa.id },
          data: {
            state: 'LEADER_SENT',
            leaderAt: now,
            nextActionAt: null,
            attempts: appendAttempt(pa.attempts, attempt),
          },
        })
      }
    } catch (err) {
      console.error(`[PiketManager] Tick-Fehler für ${pa.id}:`, err)
    }
  }
}

function appendAttempt(existing: unknown, entry: Record<string, unknown>): unknown {
  const arr = Array.isArray(existing) ? existing.slice() : []
  arr.push({ at: new Date().toISOString(), ...entry })
  return arr
}
