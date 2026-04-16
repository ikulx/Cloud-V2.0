import nodemailer from 'nodemailer'
import { env } from '../config/env'

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    if (!env.smtp.host) {
      console.warn('[Mail] SMTP nicht konfiguriert – E-Mails werden nur geloggt')
      transporter = nodemailer.createTransport({ jsonTransport: true })
    } else {
      transporter = nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        auth: {
          user: env.smtp.user,
          pass: env.smtp.password,
        },
      })
    }
  }
  return transporter
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const t = getTransporter()
  const info = await t.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
  })

  if (!env.smtp.host) {
    // Im Dev-Modus: E-Mail in Console ausgeben
    const parsed = JSON.parse(info.message)
    console.log(`[Mail] DEV → ${to}`)
    console.log(`[Mail] Subject: ${parsed.subject}`)
    console.log(`[Mail] Body:\n${parsed.html}\n`)
  } else {
    console.log(`[Mail] Gesendet an ${to}: ${subject}`)
  }
}

export async function sendInvitationMail(
  email: string,
  inviterName: string,
  token: string,
): Promise<void> {
  const link = `${env.appUrl}/invite/${token}`

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
