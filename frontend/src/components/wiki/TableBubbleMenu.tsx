import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/react'
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

interface Props {
  editor: Editor
}

/**
 * Schwebendes Aktions-Menü, das erscheint, sobald der Cursor in einer
 * Tabelle steht – bietet die wichtigsten Zeilen-/Spalten-Kommandos der
 * TipTap-Table-Extension als Icon-Buttons.
 */
export function TableBubbleMenu({ editor }: Props) {
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
          {btn({ title: 'Ganze Tabelle löschen', icon: <DeleteSweepIcon fontSize="small" />, onClick: () => editor.chain().focus().deleteTable().run(), color: 'error' })}
        </Box>
      </Paper>
    </BubbleMenu>
  )
}
