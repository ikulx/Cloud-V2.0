import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import { ResizableImage } from './ResizableImage'
import { Drawio } from './Drawio'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { SlashCommand } from './slash-command'

import './wiki-editor.css'

const lowlight = createLowlight(common)

interface WikiEditorProps {
  content: unknown
  editable: boolean
  onChange?: (json: unknown) => void
}

export function WikiEditor({ content, editable, onChange }: WikiEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const editor: Editor | null = useEditor(
    {
      editorProps: {
        handlePaste: (view, event) => {
          if (!editable) return false
          const files = Array.from(event.clipboardData?.files ?? [])
          const images = files.filter((f) => f.type.startsWith('image/'))
          if (images.length === 0) return false
          event.preventDefault()
          void uploadAndInsert(images, view)
          return true
        },
        handleDrop: (view, event) => {
          if (!editable) return false
          const files = Array.from(event.dataTransfer?.files ?? [])
          const images = files.filter((f) => f.type.startsWith('image/'))
          if (images.length === 0) return false
          event.preventDefault()
          void uploadAndInsert(images, view, event as DragEvent)
          return true
        },
      },
      extensions: [
        StarterKit.configure({
          codeBlock: false, // ersetzt durch CodeBlockLowlight
        }),
        Placeholder.configure({
          placeholder: ({ node }) => {
            if (node.type.name === 'heading') return 'Überschrift …'
            return "Schreibe los oder tippe '/' für Befehle"
          },
        }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer' },
        }),
        ResizableImage.configure({ inline: false, HTMLAttributes: { class: 'wiki-img' } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow, TableHeader, TableCell,
        CodeBlockLowlight.configure({ lowlight }),
        Drawio,
        SlashCommand,
      ],
      content: isValidDoc(content) ? content : { type: 'doc', content: [] },
      editable,
      onUpdate: ({ editor }) => {
        onChangeRef.current?.(editor.getJSON())
      },
    },
    [editable],
  )

  // Wenn sich die Seite ändert (neue Page geladen) → Editor-Content ersetzen
  useEffect(() => {
    if (!editor) return
    const current = editor.getJSON()
    if (JSON.stringify(current) !== JSON.stringify(content)) {
      editor.commands.setContent(isValidDoc(content) ? (content as object) : { type: 'doc', content: [] }, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, editor])

  if (!editor) return null

  return <EditorContent editor={editor} className="wiki-editor" />
}

function isValidDoc(c: unknown): c is object {
  return !!c && typeof c === 'object' && (c as { type?: string }).type === 'doc'
}

/** Lädt Bilder zum Backend hoch und fügt sie als Image-Nodes in das Dokument ein.
 *  Bei einem Drop-Event wird an der Drop-Position eingefügt, sonst an der
 *  aktuellen Auswahl. */
async function uploadAndInsert(
  files: File[],
  view: import('@tiptap/pm/view').EditorView,
  dropEvent?: DragEvent,
) {
  const token = localStorage.getItem('accessToken')
  for (const file of files) {
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/wiki/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      if (!res.ok) throw new Error('Upload fehlgeschlagen')
      const data = await res.json() as { url: string }

      const { schema } = view.state
      const node = schema.nodes.image?.create({ src: data.url })
      if (!node) continue

      if (dropEvent) {
        const pos = view.posAtCoords({ left: dropEvent.clientX, top: dropEvent.clientY })
        const tr = view.state.tr.insert(pos?.pos ?? view.state.selection.from, node)
        view.dispatch(tr)
      } else {
        const tr = view.state.tr.replaceSelectionWith(node)
        view.dispatch(tr)
      }
    } catch (err) {
      console.error('[WikiEditor] Bild-Upload fehlgeschlagen:', err)
      window.alert(err instanceof Error ? err.message : 'Bild-Upload fehlgeschlagen')
    }
  }
}
