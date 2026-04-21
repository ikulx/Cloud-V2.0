import { generateJSON } from '@tiptap/html'
import { marked } from 'marked'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { ResizableImage } from './ResizableImage'

/**
 * Extensions, mit denen wir eingehenden HTML-Inhalt parsen. Das Set ist
 * absichtlich kleiner als im Live-Editor: Drawio-/FileAttachment-/
 * ImportantBlock-Nodes kommen aus dem Import nicht vor, deshalb brauchen
 * wir sie für den Parser nicht. Alles, was nicht erkannt wird, landet in
 * Absätzen/Texten – das ist ok für BookStack-Exports.
 */
const lowlight = createLowlight(common)
const EXTS = [
  StarterKit,
  Link.configure({ openOnClick: false }),
  TaskList, TaskItem.configure({ nested: true }),
  Table, TableRow, TableHeader, TableCell,
  CodeBlockLowlight.configure({ lowlight }),
  Underline,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ResizableImage,
]

export type ImportSource = 'html' | 'markdown'

export interface ImportResult {
  title: string
  content: unknown // TipTap JSON
  images: number
  warnings: string[]
}

/** Entfernt BookStack-typisches Markup + hostspezifische Skripte/Styles. */
function cleanHtml(raw: string): string {
  let html = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // BookStack-Export wrappt den Seiteninhalt in <div class="page-content">
    .replace(/^[\s\S]*?<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*$/i, '')
  // BookStack-Seitentitel ist in <h1 class="page-title"> gekapselt; lassen wir
  // drin, aber der Parser extrahiert ihn separat als page-Titel (siehe unten).
  return html
}

/** Pickt den Seitentitel aus dem HTML (H1 oder <title>). */
function extractTitle(doc: Document, fallback: string): string {
  const h1 = doc.querySelector('h1')
  if (h1?.textContent?.trim()) return h1.textContent.trim()
  const t = doc.querySelector('title')
  if (t?.textContent?.trim()) return t.textContent.trim()
  return fallback
}

/** Entfernt das erste H1 aus dem Baum (wird separat als Titel verwendet). */
function stripFirstH1(root: Element): void {
  const h1 = root.querySelector('h1')
  if (h1) h1.remove()
}

/** Zählt Bilder im Dokument (nur für die Import-Zusammenfassung). */
function countImages(root: Element): number {
  return root.querySelectorAll('img').length
}

/** Haupteinstieg: liest den Datei-Inhalt und liefert Titel + TipTap-JSON. */
export async function parseImportFile(
  file: File,
): Promise<ImportResult> {
  const text = await file.text()
  const baseName = file.name.replace(/\.(html?|md|markdown)$/i, '')
  const isMarkdown = /\.(md|markdown)$/i.test(file.name)
    || !/<(html|body|h1|p|div)[\s>]/i.test(text)

  let html: string
  if (isMarkdown) {
    html = await Promise.resolve(marked.parse(text) as string)
  } else {
    html = cleanHtml(text)
  }

  // DOM parsen, Titel extrahieren, H1 entfernen damit er nicht doppelt im Body steht
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html')
  const title = extractTitle(doc, baseName)
  stripFirstH1(doc.body)
  const images = countImages(doc.body)

  const cleanedHtml = doc.body.innerHTML
  const json = generateJSON(cleanedHtml, EXTS)

  const warnings: string[] = []
  // Hinweise an den User, ohne Import zu blockieren
  if (doc.querySelector('img[src^="http"]')) {
    warnings.push('Bilder verweisen auf externe URLs (z.B. BookStack-Server). ' +
      'Sollten die Quelle später offline gehen, bitte die Bilder in BookStack als ' +
      '"mit Bildern" exportieren oder hier im Editor erneut einfügen.')
  }
  if (doc.querySelector('details')) {
    warnings.push('Aufklappbare Abschnitte (details) werden als einfache Absätze importiert.')
  }

  return { title, content: json, images, warnings }
}
