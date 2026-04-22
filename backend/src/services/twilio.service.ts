/**
 * Twilio-Service
 * ──────────────
 * Minimale SMS + Voice-Anbindung ohne zusätzliche Abhängigkeit – spricht
 * direkt gegen die Twilio-REST-API. Konfiguration kommt aus SystemSettings
 * (twilio.accountSid / twilio.authToken / twilio.fromNumber / twilio.enabled).
 *
 * - sendSms(to, body): POST /Messages.json
 * - makeCall(to, sayText): POST /Calls.json mit dynamisch erzeugtem TwiML
 */

import { getSetting } from '../routes/settings.router'

interface TwilioConfig {
  accountSid: string
  authToken: string
  fromNumber: string
  enabled: boolean
}

async function readConfig(): Promise<TwilioConfig> {
  const [sid, token, from, enabled] = await Promise.all([
    getSetting('twilio.accountSid'),
    getSetting('twilio.authToken'),
    getSetting('twilio.fromNumber'),
    getSetting('twilio.enabled'),
  ])
  return {
    accountSid: sid.trim(),
    authToken:  token.trim(),
    fromNumber: from.trim(),
    enabled:    enabled === 'true' || enabled === '1',
  }
}

function authHeader(cfg: TwilioConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')
}

export interface TwilioResult {
  ok: boolean
  sid?: string
  status?: string
  error?: string
}

/**
 * Sendet eine SMS via Twilio. Liefert `{ ok: false, error: "..." }` zurück,
 * wenn Twilio nicht konfiguriert oder deaktiviert ist – wirft nicht.
 */
export async function sendSms(to: string, body: string): Promise<TwilioResult> {
  const cfg = await readConfig()
  if (!cfg.enabled)    return { ok: false, error: 'twilio_disabled' }
  if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
    return { ok: false, error: 'twilio_not_configured' }
  }
  if (!to?.trim()) return { ok: false, error: 'missing_to' }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`
  const params = new URLSearchParams({
    From: cfg.fromNumber,
    To:   to.trim(),
    Body: body.slice(0, 1550), // Twilio akzeptiert max 1600 Zeichen
  })
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader(cfg),
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number }
    if (!res.ok) {
      return { ok: false, error: data.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, sid: data.sid, status: data.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Löst einen Anruf aus. `sayText` wird vorgelesen (de-DE), Anruf wird dann
 * automatisch beendet.
 */
export async function makeCall(to: string, sayText: string): Promise<TwilioResult> {
  const cfg = await readConfig()
  if (!cfg.enabled) return { ok: false, error: 'twilio_disabled' }
  if (!cfg.accountSid || !cfg.authToken || !cfg.fromNumber) {
    return { ok: false, error: 'twilio_not_configured' }
  }
  if (!to?.trim()) return { ok: false, error: 'missing_to' }

  const safeText = sayText.replace(/[<&>"']/g, (c) => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' } as Record<string,string>)[c] ?? c)
  const twiml = `<Response><Say language="de-DE" voice="Polly.Marlene">${safeText}</Say></Response>`

  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Calls.json`
  const params = new URLSearchParams({
    From: cfg.fromNumber,
    To:   to.trim(),
    Twiml: twiml,
  })
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader(cfg),
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string }
    if (!res.ok) {
      return { ok: false, error: data.message ?? `HTTP ${res.status}` }
    }
    return { ok: true, sid: data.sid, status: data.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Self-test: prüft, ob Credentials gültig sind (fetch Account ohne Seiteneffekt). */
export async function testTwilioCredentials(): Promise<{ ok: boolean; message: string }> {
  const cfg = await readConfig()
  if (!cfg.accountSid || !cfg.authToken) {
    return { ok: false, message: 'accountSid oder authToken fehlt' }
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}.json`, {
      headers: { 'Authorization': authHeader(cfg) },
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, message: `HTTP ${res.status} – ${t.slice(0, 200)}` }
    }
    const data = (await res.json()) as { friendly_name?: string; status?: string }
    return { ok: true, message: `OK – ${data.friendly_name ?? cfg.accountSid} (${data.status ?? '—'})` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
