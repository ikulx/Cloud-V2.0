import { env } from '../config/env'

/**
 * Sehr dünner DeepL-Wrapper. Unterstützt Batch-Übersetzung mehrerer Strings
 * in einem Request (bis 50 Texte pro Call, API-Limit) und gibt immer ein
 * Array gleicher Länge wie die Eingabe zurück.
 *
 * Wenn kein API-Key konfiguriert ist, gibt die Funktion `null` zurück –
 * der Aufrufer behandelt das als "Übersetzung nicht verfügbar".
 */

export type DeepLLang = 'EN' | 'DE' | 'FR' | 'IT'

const LANG_MAP: Record<string, DeepLLang | null> = {
  en: 'EN',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
}

export function isDeeplEnabled(): boolean {
  return env.deepl.apiKey.length > 0
}

export function toDeepLLang(code: string): DeepLLang | null {
  return LANG_MAP[code.toLowerCase()] ?? null
}

function apiBase(): string {
  return env.deepl.tier === 'pro'
    ? 'https://api.deepl.com/v2/translate'
    : 'https://api-free.deepl.com/v2/translate'
}

export async function translateBatch(
  texts: string[],
  sourceLang: string,
  targetLang: string,
): Promise<string[] | null> {
  if (!isDeeplEnabled()) return null
  if (texts.length === 0) return []

  const src = toDeepLLang(sourceLang)
  const tgt = toDeepLLang(targetLang)
  if (!src || !tgt || src === tgt) return texts

  // DeepL erlaubt bis 50 text-Parameter pro Request – wir batchen in Blöcken.
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

    const res = await fetch(apiBase(), {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${env.deepl.apiKey}`,
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
