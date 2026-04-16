import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/require-permission'

const router = Router()

export const SETTING_KEYS = [
  'pi.serverUrl',
  'pi.mqttHost',
  'pi.mqttPort',
  'smtp.host',
  'smtp.port',
  'smtp.secure',
  'smtp.user',
  'smtp.password',
  'smtp.from',
  'app.url',
] as const

export type SettingKey = typeof SETTING_KEYS[number]

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  'pi.serverUrl': 'https://DEINE-DOMAIN.example.com',
  'pi.mqttHost': 'mqtt.DEINE-DOMAIN.example.com',
  'pi.mqttPort': '1883',
  'smtp.host': '',
  'smtp.port': '587',
  'smtp.secure': 'false',
  'smtp.user': '',
  'smtp.password': '',
  'smtp.from': 'YControl Cloud <noreply@ycontrol.local>',
  'app.url': 'http://localhost:5173',
}

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value ?? DEFAULT_SETTINGS[key]
}

// GET /api/settings
router.get('/', authenticate, requirePermission('devices:read'), async (_req, res) => {
  const rows = await prisma.systemSetting.findMany()
  const result: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const row of rows) result[row.key] = row.value
  res.json(result)
})

// PATCH /api/settings
router.patch('/', authenticate, requirePermission('devices:update'), async (req, res) => {
  const parsed = z.record(z.string(), z.string()).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ message: 'Ungültige Eingabe' }); return }

  const allowed = new Set<string>(SETTING_KEYS)
  const updates = Object.entries(parsed.data).filter(([k]) => allowed.has(k))

  await Promise.all(updates.map(([key, value]) =>
    prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  ))

  const rows = await prisma.systemSetting.findMany()
  const result: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const row of rows) result[row.key] = row.value
  res.json(result)
})

// POST /api/settings/test-mail  –  Test-E-Mail senden
router.post('/test-mail', authenticate, requirePermission('roles:read'), async (req, res) => {
  // roles:read = nur admin (verwalter hat diese Permission nicht)
  const { sendTestMail } = await import('../services/mail.service')
  const email = req.user!.email
  try {
    await sendTestMail(email)
    res.json({ message: `Test-E-Mail an ${email} gesendet.` })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ message: `Senden fehlgeschlagen: ${msg}` })
  }
})

export default router
