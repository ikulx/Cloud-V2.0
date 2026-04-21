import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
import { DOMSerializer } from '@tiptap/pm/model'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Divider from '@mui/material/Divider'
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop'
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom'
import FormatIndentIncreaseIcon from '@mui/icons-material/FormatIndentIncrease'
import FormatIndentDecreaseIcon from '@mui/icons-material/FormatIndentDecrease'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import MergeIcon from '@mui/icons-material/Merge'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import ViewHeadlineIcon from '@mui/icons-material/ViewHeadline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

interface Props {
  editor: Editor
}

/**
 * Schwebendes Aktions-Menü, das erscheint, sobald der Cursor in einer
 * Tabelle steht – bietet die wichtigsten Zeilen-/Spalten-Kommandos der
 * TipTap-Table-Extension als Icon-Buttons.
 */
export function TableBubbleMenu({ editor }: Props) {
  /** Kopiert die aktuelle Tabelle als HTML + Plaintext in die Zwischenablage,
   *  sodass sie sowohl im Wiki selbst als auch in andere Apps (Word, Excel …)
   *  eingefügt werden kann. */
  const copyTable = async () => {
    const { state } = editor
    const { $from } = state.selection
    // Enclosing table-Node im Baum suchen
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node.type.name === 'table') {
        const serializer = DOMSerializer.fromSchema(state.schema)
        const fragment = serializer.serializeNode(node) as DocumentFragment | HTMLElement
        const container = document.createElement('div')
        container.appendChild(fragment)
        const html = container.innerHTML
        const text = container.innerText
        try {
          const cb = navigator.clipboard as unknown as {
            write?: (data: ClipboardItem[]) => Promise<void>
            writeText?: (s: string) => Promise<void>
          }
          if (cb?.write) {
            await cb.write([
              new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
              }),
            ])
          } else if (cb?.writeText) {
            await cb.writeText(text)
          } else {
            throw new Error('Clipboard-API nicht verfügbar')
          }
        } catch (err) {
          console.error('[TableCopy] Clipboard schlug fehl:', err)
          window.alert('Kopieren fehlgeschlagen – bitte Zwischenablage-Freigabe im Browser prüfen.')
        }
        return
      }
    }
  }
  const btn = (opts: { title: string; icon: React.ReactNode; onClick: () => void; color?: 'error' }) => (
    <Tooltip title={opts.title}>
      <span>
        <IconButton
          size="small"
          tabIndex={-1}
          disableRipple
          disableFocusRipple
          onMouseDown={(e) => { e.preventDefault(); opts.onClick() }}
          sx={{ color: opts.color === 'error' ? 'error.main' : 'text.secondary' }}
        >
          {opts.icon}
        </IconButton>
      </span>
    </Tooltip>
  )

  const divider = <Divider orientation="vertical" flexItem sx={{ mx: 0.25, my: 0.5 }} />

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor }) => editor.isActive('table')}
      options={{ placement: 'top' }}
    >
      <Paper elevation={6} sx={{ p: 0.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {btn({ title: 'Zeile oben einfügen', icon: <VerticalAlignTopIcon fontSize="small" />, onClick: () => editor.chain().focus().addRowBefore().run() })}
          {btn({ title: 'Zeile unten einfügen', icon: <VerticalAlignBottomIcon fontSize="small" />, onClick: () => editor.chain().focus().addRowAfter().run() })}
          {btn({ title: 'Zeile löschen', icon: <DeleteIcon fontSize="small" />, onClick: () => editor.chain().focus().deleteRow().run(), color: 'error' })}
          {divider}
          {btn({ title: 'Spalte links einfügen', icon: <FormatIndentDecreaseIcon fontSize="small" />, onClick: () => editor.chain().focus().addColumnBefore().run() })}
          {btn({ title: 'Spalte rechts einfügen', icon: <FormatIndentIncreaseIcon fontSize="small" />, onClick: () => editor.chain().focus().addColumnAfter().run() })}
          {btn({ title: 'Spalte löschen', icon: <DeleteIcon fontSize="small" />, onClick: () => editor.chain().focus().deleteColumn().run(), color: 'error' })}
          {divider}
          {btn({ title: 'Header-Zeile umschalten', icon: <ViewHeadlineIcon fontSize="small" />, onClick: () => editor.chain().focus().toggleHeaderRow().run() })}
          {btn({ title: 'Zellen verbinden', icon: <MergeIcon fontSize="small" />, onClick: () => editor.chain().focus().mergeCells().run() })}
          {btn({ title: 'Zelle aufteilen', icon: <CallSplitIcon fontSize="small" />, onClick: () => editor.chain().focus().splitCell().run() })}
          {divider}
          {btn({ title: 'Tabelle in Zwischenablage kopieren', icon: <ContentCopyIcon fontSize="small" />, onClick: copyTable })}
          {btn({ title: 'Ganze Tabelle löschen', icon: <DeleteSweepIcon fontSize="small" />, onClick: () => editor.chain().focus().deleteTable().run(), color: 'error' })}
        </Box>
      </Paper>
    </BubbleMenu>
  )
}
