import { generateJSON } from '@tiptap/html'
import { marked } from 'marked'
import JSZip from 'jszip'
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
 * Eingehendes HTML aus BookStack-Exports o.ä. wird in das gleiche TipTap-
 * JSON umgewandelt, das der Live-Editor verwendet. Die Extension-Liste ist
 * absichtlich ein Subset – unbekannte Blocks fallen zu Absätzen zurück.
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

export interface ImportResult {
  title: string
  content: unknown // TipTap JSON
  images: number
  warnings: string[]
}

/** Entfernt HTML-Rauschen aus BookStack-Exports. */
function cleanHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/^[\s\S]*?<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*$/i, '')
}

function extractTitle(doc: Document, fallback: string): string {
  const h1 = doc.querySelector('h1')
  if (h1?.textContent?.trim()) return h1.textContent.trim()
  const t = doc.querySelector('title')
  if (t?.textContent?.trim()) return t.textContent.trim()
  return fallback
}

function stripFirstH1(root: Element): void {
  const h1 = root.querySelector('h1')
  if (h1) h1.remove()
}

function countImages(root: Element): number {
  return root.querySelectorAll('img').length
}

/** Normalisiert einen Pfad innerhalb des ZIP (ohne führende Slashes, .. entfernen). */
function normalizePath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.')
  const out: string[] = []
  for (const s of parts) {
    if (s === '..') out.pop()
    else out.push(s)
  }
  return out.join('/')
}

/** Löst einen relativen Image-Pfad gegen den Standort der HTML-Datei auf. */
function resolveRelative(baseFile: string, rel: string): string {
  if (/^https?:\/\//i.test(rel) || rel.startsWith('data:')) return rel
  const baseDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : ''
  return normalizePath(baseDir ? `${baseDir}/${rel}` : rel)
}

/** Lädt ein Blob auf den Server, liefert die öffentliche URL zurück. */
async function uploadBlob(blob: Blob, fileName: string): Promise<string> {
  const token = localStorage.getItem('accessToken')
  const fd = new FormData()
  fd.append('file', new File([blob], fileName, { type: blob.type || 'application/octet-stream' }))
  const res = await fetch('/api/wiki/upload', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  })
  if (!res.ok) {
    let msg = 'Upload fehlgeschlagen'
    try { const err = await res.json() as { message?: string }; msg = err.message ?? msg } catch { /* noop */ }
    throw new Error(msg)
  }
  const data = await res.json() as { url: string }
  return data.url
}

/** Konvertiert eine HTML-Zeichenfolge + optionale Ressourcen-Map (ZIP-Inhalt)
 *  in ein ImportResult. Bilder mit relativen Pfaden werden gegen die Map
 *  aufgelöst, hochgeladen und der src entsprechend umgeschrieben. */
async function convertHtmlToImport(
  html: string,
  fallbackTitle: string,
  resources: Map<string, string> | null, // key = normalisierter Pfad in ZIP, value = hochgeladene URL
  htmlPath = '',
): Promise<ImportResult> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html')

  const title = extractTitle(doc, fallbackTitle)
  stripFirstH1(doc.body)

  const warnings: string[] = []

  // Bilder umschreiben
  const imgs = Array.from(doc.body.querySelectorAll('img'))
  for (const img of imgs) {
    const src = img.getAttribute('src') || ''
    if (!src) continue
    if (src.startsWith('data:')) {
      // data:-URIs bleiben so stehen – funktionieren direkt im Browser.
      continue
    }
    if (resources) {
      const resolved = resolveRelative(htmlPath, src)
      const url = resources.get(resolved)
      if (url) {
        img.setAttribute('src', url)
        continue
      }
    }
    if (/^https?:\/\//i.test(src)) {
      warnings.push(`Bild verweist auf externe URL: ${src.slice(0, 80)}`)
    }
  }
  const images = countImages(doc.body)

  if (doc.querySelector('details')) {
    warnings.push('Aufklappbare Abschnitte (details) werden als einfache Absätze importiert.')
  }

  const json = generateJSON(doc.body.innerHTML, EXTS)
  return { title, content: json, images, warnings }
}

function isHtmlFile(name: string): boolean { return /\.(html?|xhtml)$/i.test(name) }
function isMarkdownFile(name: string): boolean { return /\.(md|markdown)$/i.test(name) }
function isImageFile(name: string): boolean { return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name) }

async function markdownToHtml(md: string): Promise<string> {
  return Promise.resolve(marked.parse(md) as string)
}

/** Single-File-Pfad für HTML oder Markdown ohne ZIP. */
export async function parseImportFile(file: File): Promise<ImportResult> {
  const text = await file.text()
  const baseName = file.name.replace(/\.(html?|md|markdown)$/i, '')
  const isMd = isMarkdownFile(file.name) || !/<(html|body|h1|p|div)[\s>]/i.test(text)
  const html = isMd ? await markdownToHtml(text) : cleanHtml(text)
  return convertHtmlToImport(html, baseName, null, file.name)
}

/** ZIP-Pfad: mehrere Seiten + Bilder. Liefert pro Seite ein ImportResult.
 *  `onProgress` wird aufgerufen, solange Bilder hochgeladen / Seiten geparst
 *  werden – kann für eine Fortschrittsanzeige verwendet werden. */
export async function parseImportZip(
  file: File,
  onProgress?: (msg: string, done: number, total: number) => void,
): Promise<ImportResult[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  // Alle Dateien katalogisieren
  const files: { path: string; entry: JSZip.JSZipObject }[] = []
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return
    files.push({ path: normalizePath(relativePath), entry })
  })

  const imageFiles = files.filter((f) => isImageFile(f.path))
  const docFiles = files.filter((f) => isHtmlFile(f.path) || isMarkdownFile(f.path))

  if (docFiles.length === 0) {
    throw new Error('Das ZIP enthält keine HTML- oder Markdown-Dateien.')
  }

  // 1) Bilder hochladen → Map<normalisierterZipPfad, öffentlicheURL>
  const resources = new Map<string, string>()
  let i = 0
  const total = imageFiles.length + docFiles.length
  for (const f of imageFiles) {
    onProgress?.(`Lade Bild: ${f.path}`, i, total)
    try {
      const blob = await f.entry.async('blob')
      const url = await uploadBlob(blob, f.path.split('/').pop() || 'image')
      resources.set(f.path, url)
    } catch (err) {
      console.warn('[import] Bild übersprungen:', f.path, err)
    }
    i++
  }

  // 2) Jede HTML/MD-Datei in ein ImportResult umwandeln
  const results: ImportResult[] = []
  for (const f of docFiles) {
    onProgress?.(`Verarbeite: ${f.path}`, i, total)
    const text = await f.entry.async('string')
    const baseName = f.path.split('/').pop()!.replace(/\.(html?|md|markdown)$/i, '')
    const html = isMarkdownFile(f.path) ? await markdownToHtml(text) : cleanHtml(text)
    const res = await convertHtmlToImport(html, baseName, resources, f.path)
    results.push(res)
    i++
  }

  onProgress?.('Fertig', total, total)
  return results
}

/** Entscheidet automatisch zwischen Einzeldatei und ZIP. */
export function isZipFile(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip'
}
