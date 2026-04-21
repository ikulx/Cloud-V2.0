import { prisma } from '../db/prisma'
import { isDeeplEnabled, translateBatch } from './deepl.service'

/** Zielsprachen, in die automatisch übersetzt wird, sobald die Quellseite
 *  gespeichert wird. Kann später pro Instanz/Env erweitert werden. */
export const AUTO_TRANSLATE_TARGETS = ['de', 'en', 'fr', 'it']

type TipTapNode = {
  type?: string
  text?: string
  content?: TipTapNode[]
  attrs?: Record<string, unknown>
}

/** Sammelt alle `text`-Strings aus einem TipTap-Dokument (Reihenfolge bleibt
 *  durch DFS erhalten). Code-Blocks bleiben erhalten, werden aber
 *  trotzdem übersetzt – der Kontext erkennt meistens, dass es Code ist und
 *  lässt ihn unangetastet, bzw. der User kann korrigieren. */
function collectTexts(node: TipTapNode | unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return
  const n = node as TipTapNode
  if (typeof n.text === 'string' && n.text.length > 0) out.push(n.text)
  if (Array.isArray(n.content)) {
    for (const c of n.content) collectTexts(c, out)
  }
}

/** Läuft das Dokument in der gleichen DFS-Reihenfolge ab und ersetzt die
 *  Texte gegen das `translated`-Array. */
function applyTexts(node: TipTapNode | unknown, pool: string[], idx: { i: number }): void {
  if (!node || typeof node !== 'object') return
  const n = node as TipTapNode
  if (typeof n.text === 'string' && n.text.length > 0) {
    n.text = pool[idx.i] ?? n.text
    idx.i++
  }
  if (Array.isArray(n.content)) {
    for (const c of n.content) applyTexts(c, pool, idx)
  }
}

/** Führt eine vollständige Übersetzung von `content` + `title` durch und
 *  liefert das übersetzte Paar. Gibt null zurück, wenn DeepL nicht konfiguriert
 *  ist – dann fällt der Aufrufer auf die Original-Daten zurück. */
export async function translatePage(
  title: string,
  content: unknown,
  sourceLang: string,
  targetLang: string,
): Promise<{ title: string; content: unknown } | null> {
  if (!isDeeplEnabled()) return null
  if (sourceLang.toLowerCase() === targetLang.toLowerCase()) {
    return { title, content }
  }

  // Titel + Textknoten als EINE Liste an DeepL schicken (weniger Overhead).
  const pool: string[] = [title]
  const clone: unknown = structuredClone(content ?? { type: 'doc', content: [] })
  collectTexts(clone, pool)

  try {
    const translated = await translateBatch(pool, sourceLang, targetLang)
    if (!translated) return null
    const [newTitle, ...rest] = translated
    applyTexts(clone, rest, { i: 0 })
    return { title: newTitle ?? title, content: clone }
  } catch (err) {
    console.error('[wiki-translate] DeepL-Fehler:', err)
    return null
  }
}

/** Reindiziert searchText analog zum Original, aber aus der Übersetzung. */
function extractPlainText(node: TipTapNode | unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as TipTapNode
  let out = ''
  if (typeof n.text === 'string') out += n.text
  if (Array.isArray(n.content)) {
    for (const c of n.content) {
      const sub = extractPlainText(c)
      if (sub) out += (out && !out.endsWith(' ') ? ' ' : '') + sub
    }
  }
  return out
}

/**
 * Stößt die automatische Übersetzung der Seite in alle AUTO_TRANSLATE_TARGETS
 * außer sourceLang an. Übersetzungen mit isEdited=true werden NIE überschrieben.
 * Läuft idempotent und nicht-blockierend (bei Fehlern wird nur geloggt).
 */
export async function refreshTranslationsForPage(pageId: string): Promise<void> {
  if (!isDeeplEnabled()) return

  const page = await prisma.wikiPage.findUnique({
    where: { id: pageId },
    select: { id: true, title: true, content: true, sourceLang: true },
  })
  if (!page) return

  // Bestehende Übersetzungen auslesen (um isEdited=true zu respektieren)
  const existing = await prisma.wikiPageTranslation.findMany({
    where: { pageId: page.id },
    select: { lang: true, isEdited: true },
  })
  const editedLangs = new Set(existing.filter((e) => e.isEdited).map((e) => e.lang))

  for (const target of AUTO_TRANSLATE_TARGETS) {
    if (target === page.sourceLang) continue
    if (editedLangs.has(target)) continue

    try {
      const result = await translatePage(page.title, page.content, page.sourceLang, target)
      if (!result) continue
      const searchText = `${result.title} ${extractPlainText(result.content)}`.trim()
      await prisma.wikiPageTranslation.upsert({
        where: { pageId_lang: { pageId: page.id, lang: target } },
        create: {
          pageId: page.id, lang: target,
          title: result.title,
          content: result.content as object,
          searchText,
          isEdited: false,
        },
        update: {
          title: result.title,
          content: result.content as object,
          searchText,
          isEdited: false,
        },
      })
    } catch (err) {
      console.error(`[wiki-translate] ${page.id} → ${target} fehlgeschlagen:`, err)
    }
  }
}
