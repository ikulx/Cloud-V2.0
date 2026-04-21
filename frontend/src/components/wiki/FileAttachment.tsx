import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

/**
 * TipTap-Node für Datei-Anhänge (nicht-Bild-Uploads).
 *
 * Persistiert:
 *   - url:  öffentlicher Link (z.B. /uploads/wiki/abc.pdf)
 *   - name: ursprünglicher Dateiname zur Anzeige
 *   - size: Dateigröße in Bytes
 *   - mime: MIME-Typ (für Icon-Wahl)
 */
export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url:  { default: '' },
      name: { default: 'Datei' },
      size: { default: 0 },
      mime: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="fileAttachment"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'fileAttachment' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },
})

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

function iconFor(mime: string, name: string): string {
  const lowerMime = mime.toLowerCase()
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  if (lowerMime === 'application/pdf' || ext === 'pdf') return '📕'
  if (lowerMime.startsWith('video/')) return '🎬'
  if (lowerMime.startsWith('audio/')) return '🎵'
  if (lowerMime.startsWith('image/')) return '🖼️'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️'
  if (['doc', 'docx', 'odt'].includes(ext)) return '📘'
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📗'
  if (['ppt', 'pptx', 'odp'].includes(ext)) return '📙'
  if (['dwg', 'dxf', 'step', 'stp', 'stl'].includes(ext)) return '📐'
  return '📎'
}

function FileAttachmentView({ node, selected }: NodeViewProps) {
  const url  = String(node.attrs.url ?? '')
  const name = String(node.attrs.name ?? 'Datei')
  const size = Number(node.attrs.size ?? 0)
  const mime = String(node.attrs.mime ?? '')

  return (
    <NodeViewWrapper
      as="div"
      className={`wiki-file-wrapper${selected ? ' selected' : ''}`}
      data-drag-handle
    >
      <a
        className="wiki-file-card"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="wiki-file-icon">{iconFor(mime, name)}</span>
        <span className="wiki-file-meta">
          <span className="wiki-file-name">{name}</span>
          <span className="wiki-file-size">
            {formatBytes(size)}{size > 0 && mime ? ' · ' : ''}{mime}
          </span>
        </span>
        <span className="wiki-file-action">⬇</span>
      </a>
    </NodeViewWrapper>
  )
}
