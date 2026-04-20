import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { DrawioDialog, type DrawioResult } from './DrawioDialog'

/**
 * TipTap-Node für drawio-Diagramme.
 *
 * Persistiert:
 *   - xml:   das komplette Diagramm-XML (Quelle der Wahrheit, editierbar)
 *   - png:   data:image/png;base64,… (Vorschau + Fallback fürs Export)
 *   - width: Breite in Pixeln (resizebar)
 */
export const Drawio = Node.create({
  name: 'drawio',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      xml: { default: '' },
      png: { default: '' },
      width: { default: 600 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="drawio"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawio' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DrawioView)
  },
})

function DrawioView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const xml = (node.attrs.xml as string) ?? ''
  const png = (node.attrs.png as string) ?? ''
  const width = typeof node.attrs.width === 'number' ? (node.attrs.width as number) : 600

  const [dialogOpen, setDialogOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const editable = editor.isEditable

  const handleSave = (res: DrawioResult) => {
    updateAttributes({ xml: res.xml, png: res.png })
  }

  const startResize = (e: React.MouseEvent, corner: 'se' | 'sw') => {
    e.preventDefault()
    e.stopPropagation()
    if (!containerRef.current) return
    const startX = e.clientX
    const startWidth = containerRef.current.getBoundingClientRect().width
    const onMove = (ev: MouseEvent) => {
      const delta = corner === 'se' ? ev.clientX - startX : startX - ev.clientX
      const next = Math.max(200, Math.round(startWidth + delta))
      updateAttributes({ width: next })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Automatisch beim Einfügen (leeres Diagramm) den Editor öffnen.
  useEffect(() => {
    if (editable && !xml && !png && !dialogOpen) {
      setDialogOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <NodeViewWrapper
      as="div"
      className={`wiki-drawio-wrapper${selected ? ' selected' : ''}`}
      data-drag-handle
    >
      <div
        ref={containerRef}
        className="wiki-drawio"
        style={{ width: `${width}px` }}
        onDoubleClick={() => editable && setDialogOpen(true)}
      >
        {png ? (
          <img src={png} alt="Diagramm" className="wiki-drawio-preview" draggable={false} />
        ) : (
          <div className="wiki-drawio-placeholder" onClick={() => editable && setDialogOpen(true)}>
            <div style={{ fontSize: 32, opacity: 0.5 }}>📐</div>
            <div>Diagramm bearbeiten</div>
          </div>
        )}

        {editable && selected && (
          <>
            <div className="wiki-drawio-toolbar" contentEditable={false}>
              <button type="button" onClick={() => setDialogOpen(true)}>Bearbeiten</button>
            </div>
            <span className="wiki-img-handle wiki-img-handle-se" onMouseDown={(e) => startResize(e, 'se')} />
            <span className="wiki-img-handle wiki-img-handle-sw" onMouseDown={(e) => startResize(e, 'sw')} />
          </>
        )}
      </div>

      <DrawioDialog
        open={dialogOpen}
        initialXml={xml}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
      />
    </NodeViewWrapper>
  )
}
