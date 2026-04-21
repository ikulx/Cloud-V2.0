import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { SlashMenuList, type SlashItem } from './SlashMenuList'

/** Liste der Slash-Befehle. Jeder Eintrag weiß, wie er sich im Editor ausführt. */
const ITEMS: SlashItem[] = [
  {
    title: 'Überschrift 1', description: 'Große Überschrift', keywords: ['h1', 'heading'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
  },
  {
    title: 'Überschrift 2', description: 'Mittlere Überschrift', keywords: ['h2'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
  },
  {
    title: 'Überschrift 3', description: 'Kleine Überschrift', keywords: ['h3'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
  },
  {
    title: 'Aufzählung', description: 'Unsortierte Liste', keywords: ['ul', 'list', 'bullet'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Nummerierte Liste', description: 'Geordnete Liste', keywords: ['ol', 'numbered'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Aufgabenliste', description: 'Checklisten mit Haken', keywords: ['todo', 'task', 'checklist'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Zitat', description: 'Blockzitat', keywords: ['quote', 'blockquote'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    title: 'Code-Block', description: 'Formatierter Code', keywords: ['code', 'pre'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: 'Tabelle', description: 'Größe und Header-Zeile frei wählbar', keywords: ['table', 'tabelle'],
    command: ({ editor, range }) => {
      // Slash-Range vorab entfernen, danach Dialog öffnen. Das eigentliche
      // insertTable passiert in WikiEditor, sobald der Dialog bestätigt wird.
      editor.chain().focus().deleteRange(range).run()
      document.dispatchEvent(new CustomEvent('wiki:open-table-dialog'))
    },
  },
  {
    title: 'Trennlinie', description: 'Horizontale Linie', keywords: ['hr', 'divider'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: 'Diagramm', description: 'drawio-Diagramm einfügen', keywords: ['diagram', 'drawio', 'flowchart', 'uml'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: 'drawio',
        attrs: { xml: '', png: '', width: 600 },
      }).run()
    },
  },
  {
    title: 'Datei', description: 'Datei hochladen und als Anhang einfügen',
    keywords: ['file', 'attachment', 'datei', 'pdf', 'anhang', 'upload'],
    command: ({ editor, range }) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const formData = new FormData()
          formData.append('file', file)
          const token = localStorage.getItem('accessToken')
          const res = await fetch('/api/wiki/upload', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          })
          if (!res.ok) {
            let msg = 'Upload fehlgeschlagen'
            try { const err = await res.json() as { message?: string }; msg = err.message ?? msg } catch { /* noop */ }
            throw new Error(msg)
          }
          const data = await res.json() as { url: string; name: string; size: number; mime: string }
          const isImage = data.mime.startsWith('image/')
          editor.chain().focus().deleteRange(range).insertContent(
            isImage
              ? { type: 'image', attrs: { src: data.url } }
              : { type: 'fileAttachment', attrs: { url: data.url, name: data.name, size: data.size, mime: data.mime } },
          ).run()
        } catch (err) {
          window.alert(err instanceof Error ? err.message : 'Upload fehlgeschlagen')
        }
      }
      input.click()
    },
  },
  {
    title: 'Bild', description: 'Bild hochladen', keywords: ['image', 'img', 'upload'],
    command: ({ editor, range }) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const formData = new FormData()
          formData.append('file', file)
          const token = localStorage.getItem('accessToken')
          const res = await fetch('/api/wiki/upload', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          })
          if (!res.ok) throw new Error('Upload fehlgeschlagen')
          const data = await res.json() as { url: string }
          editor.chain().focus().deleteRange(range).setImage({ src: data.url }).run()
        } catch (err) {
          window.alert(err instanceof Error ? err.message : 'Upload fehlgeschlagen')
        }
      }
      input.click()
    },
  },
]

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        command: ({ editor, range, props }) => {
          const item = props as SlashItem
          item.command({ editor, range })
        },
        items: ({ query }) => {
          const q = query.toLowerCase()
          return ITEMS.filter((item) =>
            item.title.toLowerCase().includes(q) ||
            item.keywords.some((k) => k.includes(q)),
          ).slice(0, 10)
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, { items: SlashItem[]; command: (i: SlashItem) => void }> | null = null
          let popup: TippyInstance | null = null

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenuList, {
                props: { items: props.items, command: (item: SlashItem) => props.command(item) },
                editor: props.editor,
              })
              if (!props.clientRect) return
              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                theme: 'light',
              })
            },
            onUpdate: (props) => {
              component?.updateProps({ items: props.items, command: (item: SlashItem) => props.command(item) })
              if (popup && props.clientRect) {
                popup.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
              }
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') { popup?.hide(); return true }
              return component?.ref?.onKeyDown?.(props.event) ?? false
            },
            onExit: () => {
              popup?.destroy()
              component?.destroy()
              popup = null
              component = null
            },
          }
        },
      }),
    ]
  },
})

export interface SlashMenuHandle {
  onKeyDown?: (event: KeyboardEvent) => boolean
}

export type SlashCommandProps = { editor: Editor; range: Range }
