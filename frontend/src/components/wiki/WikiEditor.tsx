import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
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
        Image.configure({ HTMLAttributes: { class: 'wiki-img' } }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow, TableHeader, TableCell,
        CodeBlockLowlight.configure({ lowlight }),
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
