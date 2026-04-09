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
] as const

export type SettingKey = typeof SETTING_KEYS[number]

export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  'pi.serverUrl': 'http://192.168.10.143:3000',
  'pi.mqttHost': '192.168.10.143',
  'pi.mqttPort': '1883',
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

export default router
