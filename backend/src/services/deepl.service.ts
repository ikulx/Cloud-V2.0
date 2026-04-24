import { env } from '../config/env'
import { prisma } from '../db/prisma'
import { SENSITIVE_SETTING_KEYS } from '../routes/settings.router'
import { decryptSecret } from '../lib/secret-crypto'

/**
 * Sehr dünner DeepL-Wrapper. Unterstützt Batch-Übersetzung mehrerer Strings
 * in einem Request (bis 50 Texte pro Call, API-Limit) und gibt immer ein
 * Array gleicher Länge wie die Eingabe zurück.
 *
 * Konfiguration (Priorität): systemSetting['deepl.apiKey'] → env DEEPL_API_KEY
 *                           systemSetting['deepl.tier']   → env DEEPL_TIER
 * So kann ein Admin im UI den Key hinterlegen, und Env wird nur als
 * Startup-Fallback genutzt.
 *
 * Wenn kein API-Key konfiguriert ist, gibt translateBatch() `null` zurück –
 * der Aufrufer behandelt das als "Übersetzung nicht verfügbar".
 */

export type DeepLLang = 'EN' | 'DE' | 'FR' | 'IT'

const LANG_MAP: Record<string, DeepLLang | null> = {
  en: 'EN',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
}

/** Config-Cache (5 s), um bei jedem TipTap-Text-Batch nicht die DB zu treffen. */
let cachedConfig: { apiKey: string; tier: 'free' | 'pro'; loadedAt: number } | null = null
const CACHE_TTL_MS = 5_000

async function loadConfig(): Promise<{ apiKey: string; tier: 'free' | 'pro' }> {
  if (cachedConfig && Date.now() - cachedConfig.loadedAt < CACHE_TTL_MS) {
    return { apiKey: cachedConfig.apiKey, tier: cachedConfig.tier }
  }
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['deepl.apiKey', 'deepl.tier'] } },
  })
  const db: Record<string, string> = {}
  for (const r of rows) {
    db[r.key] = SENSITIVE_SETTING_KEYS.has(r.key) ? decryptSecret(r.value) : r.value
  }

  const apiKey = db['deepl.apiKey'] || env.deepl.apiKey || ''
  const rawTier = (db['deepl.tier'] || env.deepl.tier || 'free').toLowerCase()
  const tier: 'free' | 'pro' = rawTier === 'pro' ? 'pro' : 'free'

  cachedConfig = { apiKey, tier, loadedAt: Date.now() }
  return { apiKey, tier }
}

/** Wird vom Settings-Endpoint aufgerufen, wenn sich Konfig ändert. */
export function invalidateDeeplConfigCache(): void {
  cachedConfig = null
}

export async function isDeeplEnabled(): Promise<boolean> {
  const cfg = await loadConfig()
  return cfg.apiKey.length > 0
}

export function toDeepLLang(code: string): DeepLLang | null {
  return LANG_MAP[code.toLowerCase()] ?? null
}

function apiBase(tier: 'free' | 'pro'): string {
  return tier === 'pro'
    ? 'https://api.deepl.com/v2/translate'
    : 'https://api-free.deepl.com/v2/translate'
}

export async function translateBatch(
  texts: string[],
  sourceLang: string,
  targetLang: string,
): Promise<string[] | null> {
  const { apiKey, tier } = await loadConfig()
  if (!apiKey) return null
  if (texts.length === 0) return []

  const src = toDeepLLang(sourceLang)
  const tgt = toDeepLLang(targetLang)
  if (!src || !tgt || src === tgt) return texts

  const BATCH = 50
  const out: string[] = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH)
    const body = new URLSearchParams()
    for (const t of chunk) body.append('text', t)
    body.append('source_lang', src)
    body.append('target_lang', tgt)
    body.append('preserve_formatting', '1')
    body.append('tag_handling', 'xml')
    body.append('formality', 'prefer_more')

    const res = await fetch(apiBase(tier), {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`DeepL HTTP ${res.status}: ${detail.slice(0, 200)}`)
    }
    const data = await res.json() as { translations: Array<{ text: string }> }
    for (const t of data.translations) out.push(t.text)
  }

  return out
}

/** Einfacher Verbindungstest. Übersetzt das Wort "Test" DE → EN. */
export async function testDeepl(): Promise<{ ok: true; usage?: { count: number; limit: number } } | { ok: false; message: string }> {
  const { apiKey, tier } = await loadConfig()
  if (!apiKey) return { ok: false, message: 'Kein API-Key konfiguriert' }
  try {
    const translated = await translateBatch(['Test'], 'de', 'en')
    if (!translated) return { ok: false, message: 'Übersetzung nicht verfügbar' }

    // Usage abrufen (nice-to-have)
    const usageUrl = tier === 'pro'
      ? 'https://api.deepl.com/v2/usage'
      : 'https://api-free.deepl.com/v2/usage'
    try {
      const r = await fetch(usageUrl, {
        headers: { 'Authorization': `DeepL-Auth-Key ${apiKey}` },
      })
      if (r.ok) {
        const u = await r.json() as { character_count: number; character_limit: number }
        return { ok: true, usage: { count: u.character_count, limit: u.character_limit } }
      }
    } catch { /* ignore */ }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
