import { useRef, useState } from 'react'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

/**
 * Erweitert die TipTap-Image-Node um:
 *  - draggable (über die Drag-Handle-Zeile oben) → verschieben innerhalb des Docs
 *  - width-Attribut → persistent gespeichert
 *  - React-NodeView mit Resize-Handles an den vier Ecken
 */
export const ResizableImage = Image.extend({
  name: 'image',
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.width ? { style: `width: ${attributes.width}px;` } : {},
        parseHTML: (element: HTMLElement) => {
          const w = element.style.width || element.getAttribute('width')
          if (!w) return null
          const n = parseInt(String(w), 10)
          return Number.isFinite(n) ? n : null
        },
      },
      align: {
        default: 'left',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-align': attributes.align ?? 'left' }),
        parseHTML: (element: HTMLElement) => element.getAttribute('data-align') ?? 'left',
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})

function ResizableImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const src = (node.attrs.src as string) ?? ''
  const alt = (node.attrs.alt as string | null) ?? ''
  const width = typeof node.attrs.width === 'number' ? (node.attrs.width as number) : null
  const align = ((node.attrs.align as string | null) ?? 'left') as 'left' | 'center' | 'right'

  const containerRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)

  const startResize = (e: React.MouseEvent, corner: 'se' | 'sw') => {
    e.preventDefault()
    e.stopPropagation()
    if (!containerRef.current) return
    const img = containerRef.current.querySelector('img')
    if (!img) return

    const startX = e.clientX
    const startWidth = img.getBoundingClientRect().width
    setResizing(true)

    const onMove = (ev: MouseEvent) => {
      const delta = corner === 'se' ? ev.clientX - startX : startX - ev.clientX
      const next = Math.max(60, Math.round(startWidth + delta))
      updateAttributes({ width: next })
    }
    const onUp = () => {
      setResizing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const setAlign = (a: 'left' | 'center' | 'right') => updateAttributes({ align: a })
  const editable = editor.isEditable

  return (
    <NodeViewWrapper
      as="div"
      className={`wiki-img-wrapper align-${align}${selected ? ' selected' : ''}`}
      data-drag-handle
    >
      <div
        ref={containerRef}
        className="wiki-img-container"
        style={{ width: width ? `${width}px` : undefined }}
      >
        <img src={src} alt={alt} draggable={false} className="wiki-img" />

        {editable && selected && (
          <>
            {/* Resize-Handles an zwei Ecken (links-unten & rechts-unten) */}
            <span
              className="wiki-img-handle wiki-img-handle-se"
              onMouseDown={(e) => startResize(e, 'se')}
            />
            <span
              className="wiki-img-handle wiki-img-handle-sw"
              onMouseDown={(e) => startResize(e, 'sw')}
            />

            {/* Ausrichtungs-Toolbar oberhalb */}
            {!resizing && (
              <div className="wiki-img-toolbar" contentEditable={false}>
                <button type="button" onClick={() => setAlign('left')}   className={align === 'left'   ? 'active' : ''} title="Links">⬅</button>
                <button type="button" onClick={() => setAlign('center')} className={align === 'center' ? 'active' : ''} title="Mitte">⬍</button>
                <button type="button" onClick={() => setAlign('right')}  className={align === 'right'  ? 'active' : ''} title="Rechts">➡</button>
              </div>
            )}
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}
