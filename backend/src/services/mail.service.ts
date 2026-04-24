import nodemailer from 'nodemailer'
import { prisma } from '../db/prisma'
import { env } from '../config/env'
import { SENSITIVE_SETTING_KEYS } from '../routes/settings.router'
import { decryptSecret } from '../lib/secret-crypto'

let transporter: nodemailer.Transporter | null = null
let lastConfigHash = ''

interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
  appUrl: string
}

/**
 * SMTP-Konfiguration laden: DB (SystemSetting) hat Vorrang, dann env, dann Default.
 */
async function loadSmtpConfig(): Promise<SmtpConfig> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'smtp.' } },
  })
  const appUrlRow = await prisma.systemSetting.findUnique({ where: { key: 'app.url' } })
  const db: Record<string, string> = {}
  for (const r of rows) {
    // smtp.password ist at-rest AES-verschlüsselt → transparent entschlüsseln.
    db[r.key] = SENSITIVE_SETTING_KEYS.has(r.key) ? decryptSecret(r.value) : r.value
  }

  return {
    host:     db['smtp.host']     || env.smtp.host     || '',
    port:     parseInt(db['smtp.port'] || String(env.smtp.port) || '587', 10),
    secure:   (db['smtp.secure']  || String(env.smtp.secure)) === 'true',
    user:     db['smtp.user']     || env.smtp.user     || '',
    password: db['smtp.password'] || env.smtp.password || '',
    from:     db['smtp.from']     || env.smtp.from     || 'YControl Cloud <noreply@ycontrol.local>',
    appUrl:   appUrlRow?.value    || env.appUrl         || 'http://localhost:5173',
  }
}

function configHash(c: SmtpConfig): string {
  return `${c.host}:${c.port}:${c.secure}:${c.user}:${c.password}`
}

/**
 * Transporter wird bei jedem Aufruf geprüft – wenn sich die Config
 * geändert hat (Admin hat Einstellungen gespeichert), wird er neu gebaut.
 */
async function getTransporter(): Promise<{ transport: nodemailer.Transporter; config: SmtpConfig }> {
  const config = await loadSmtpConfig()
  const hash = configHash(config)

  if (!transporter || hash !== lastConfigHash) {
    if (!config.host) {
      console.warn('[Mail] SMTP nicht konfiguriert – E-Mails werden nur geloggt')
      transporter = nodemailer.createTransport({ jsonTransport: true })
    } else {
      transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.password },
      })
    }
    lastConfigHash = hash
  }

  return { transport: transporter, config }
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const { transport, config } = await getTransporter()
  const info = await transport.sendMail({ from: config.from, to, subject, html })

  if (!config.host) {
    const parsed = JSON.parse(info.message)
    console.log(`[Mail] DEV → ${to}`)
    console.log(`[Mail] Subject: ${parsed.subject}`)
    console.log(`[Mail] Body:\n${parsed.html}\n`)
  } else {
    console.log(`[Mail] Gesendet an ${to}: ${subject}`)
  }
}

export async function sendTestMail(to: string): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #333;">
  <div style="background: #1976d2; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">YControl Cloud</h1>
  </div>
  <div style="border: 1px solid #e0e0e0; border-top: none; padding: 32px 24px; border-radius: 0 0 8px 8px;">
    <p>Dies ist eine <strong>Test-E-Mail</strong> von der YControl Cloud.</p>
    <p>Wenn Sie diese Nachricht sehen, funktioniert die SMTP-Konfiguration korrekt.</p>
    <p style="font-size: 13px; color: #999; margin-top: 24px;">
      Gesendet am ${new Date().toLocaleString('de-CH')}
    </p>
  </div>
</body>
</html>`
  await sendMail(to, 'YControl Cloud – Test-E-Mail', html)
}

export async function sendInvitationMail(
  email: string,
  inviterName: string,
  token: string,
): Promise<void> {
  const { config } = await getTransporter()
  const link = `${config.appUrl}/invite/${token}`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #333;">
  <div style="background: #1976d2; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">YControl Cloud</h1>
  </div>
  <div style="border: 1px solid #e0e0e0; border-top: none; padding: 32px 24px; border-radius: 0 0 8px 8px;">
    <p>Hallo,</p>
    <p><strong>${inviterName}</strong> hat Sie zur YControl Cloud eingeladen.</p>
    <p>Klicken Sie auf den folgenden Button, um Ihr Konto einzurichten:</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${link}"
         style="display: inline-block; padding: 14px 32px; background: #1976d2; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Konto erstellen
      </a>
    </div>
    <p style="font-size: 13px; color: #666;">
      Oder kopieren Sie diesen Link in Ihren Browser:<br>
      <a href="${link}" style="color: #1976d2; word-break: break-all;">${link}</a>
    </p>
    <p style="font-size: 13px; color: #999; margin-top: 32px;">
      Dieser Link ist 7 Tage gültig. Falls Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.
    </p>
  </div>
</body>
</html>`

  await sendMail(email, `Einladung zur YControl Cloud von ${inviterName}`, html)
}

/**
 * 2FA-Anmeldecode für privilegierte Rollen (admin/verwalter).
 * Code ist 6-stellig, 10 Minuten gültig.
 */
export async function sendLoginCodeMail(email: string, code: string): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #333;">
  <div style="background: #1976d2; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">YControl Cloud</h1>
  </div>
  <div style="border: 1px solid #e0e0e0; border-top: none; padding: 32px 24px; border-radius: 0 0 8px 8px;">
    <p>Hallo,</p>
    <p>jemand hat sich gerade mit Ihren Zugangsdaten bei der YControl Cloud angemeldet.</p>
    <p>Zum Abschluss der Anmeldung geben Sie bitte diesen Bestätigungscode ein:</p>
    <div style="text-align: center; margin: 32px 0;">
      <div style="display: inline-block; padding: 18px 40px; background: #f3f7fb; border: 1px solid #cfe1f2; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1976d2;">
        ${code}
      </div>
    </div>
    <p style="font-size: 13px; color: #666;">
      Der Code ist <strong>10 Minuten</strong> gültig und kann nur einmal verwendet werden.
    </p>
    <p style="font-size: 13px; color: #999; margin-top: 32px;">
      Wenn Sie sich <strong>nicht</strong> angemeldet haben, ignorieren Sie diese E-Mail
      und ändern Sie vorsichtshalber Ihr Passwort.
    </p>
  </div>
</body>
</html>`

  await sendMail(email, `YControl Cloud – Ihr Anmeldecode: ${code}`, html)
}

/**
 * Passwort-Reset-Link. Der Token ist im Link enthalten und darf nur einmal
 * verwendet werden.
 */
/**
 * Alarm-Benachrichtigung per E-Mail.
 * Wird vom Alarm-Dispatcher aufgerufen, wenn ein Gerät einen Alarm meldet.
 */
export async function sendAlarmMail(
  email: string,
  params: {
    priority: string
    message: string
    anlageName: string
    projectNumber?: string | null
    deviceName: string
    serial: string
    activatedAt: Date
    source?: string | null
  },
): Promise<void> {
  const color =
    params.priority === 'PRIO1' ? '#c62828' :
    params.priority === 'PRIO2' ? '#e64a19' :
    params.priority === 'PRIO3' ? '#f57c00' :
    params.priority === 'WARNING' ? '#f9a825' : '#1976d2'

  const priorityLabel =
    params.priority === 'PRIO1' ? 'Priorität 1 – kritisch' :
    params.priority === 'PRIO2' ? 'Priorität 2' :
    params.priority === 'PRIO3' ? 'Priorität 3' :
    params.priority === 'WARNING' ? 'Warnung' : 'Info'

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #333;">
  <div style="background: ${color}; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 20px;">${priorityLabel}</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 13px;">YControl Cloud – Alarmmeldung</p>
  </div>
  <div style="border: 1px solid #e0e0e0; border-top: none; padding: 28px 24px; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; margin-top: 0;"><strong>${escapeHtml(params.message)}</strong></p>
    <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
      <tr><td style="padding: 6px 0; color: #666; width: 140px;">Anlage</td><td style="padding: 6px 0;">${escapeHtml(params.anlageName)}${params.projectNumber ? ' <span style="color:#999;">(' + escapeHtml(params.projectNumber) + ')</span>' : ''}</td></tr>
      <tr><td style="padding: 6px 0; color: #666;">Gerät</td><td style="padding: 6px 0;">${escapeHtml(params.deviceName)} <span style="color:#999;">(${escapeHtml(params.serial)})</span></td></tr>
      <tr><td style="padding: 6px 0; color: #666;">Zeitpunkt</td><td style="padding: 6px 0;">${params.activatedAt.toLocaleString('de-CH')}</td></tr>
      ${params.source ? `<tr><td style="padding: 6px 0; color: #666;">Quelle</td><td style="padding: 6px 0; font-family: monospace; font-size: 12px;">${escapeHtml(params.source)}</td></tr>` : ''}
    </table>
    <p style="font-size: 13px; color: #999; margin-top: 28px; border-top: 1px solid #eee; padding-top: 16px;">
      Diese Nachricht wurde automatisch vom YControl-Cloud-Alarmsystem erstellt.
      Sie können Empfänger und Eskalationsregeln für diese Anlage über die Cloud verwalten.
    </p>
  </div>
</body>
</html>`

  await sendMail(email, `[${priorityLabel}] ${params.anlageName}: ${params.message}`, html)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string))
}

export async function sendPasswordResetMail(email: string, token: string): Promise<void> {
  const { config } = await getTransporter()
  const link = `${config.appUrl}/reset-password/${token}`

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #333;">
  <div style="background: #1976d2; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">YControl Cloud</h1>
  </div>
  <div style="border: 1px solid #e0e0e0; border-top: none; padding: 32px 24px; border-radius: 0 0 8px 8px;">
    <p>Hallo,</p>
    <p>es wurde ein neues Passwort für Ihr Konto bei der YControl Cloud angefordert.</p>
    <p>Klicken Sie auf den folgenden Button, um ein neues Passwort zu vergeben:</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${link}"
         style="display: inline-block; padding: 14px 32px; background: #1976d2; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
        Passwort zurücksetzen
      </a>
    </div>
    <p style="font-size: 13px; color: #666;">
      Oder kopieren Sie diesen Link in Ihren Browser:<br>
      <a href="${link}" style="color: #1976d2; word-break: break-all;">${link}</a>
    </p>
    <p style="font-size: 13px; color: #999; margin-top: 32px;">
      Der Link ist <strong>1 Stunde</strong> gültig und kann nur einmal verwendet werden.
      Falls Sie kein neues Passwort angefordert haben, ignorieren Sie diese E-Mail –
      Ihr aktuelles Passwort bleibt unverändert.
    </p>
  </div>
</body>
</html>`

  await sendMail(email, 'YControl Cloud – Passwort zurücksetzen', html)
}
