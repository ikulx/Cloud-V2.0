import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Divider from '@mui/material/Divider'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import CodeIcon from '@mui/icons-material/Code'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import CheckBoxOutlinedIcon from '@mui/icons-material/CheckBoxOutlined'
import FormatQuoteIcon from '@mui/icons-material/FormatQuote'
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft'
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter'
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight'
import FormatAlignJustifyIcon from '@mui/icons-material/FormatAlignJustify'
import LinkIcon from '@mui/icons-material/Link'
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule'
import UndoIcon from '@mui/icons-material/Undo'
import RedoIcon from '@mui/icons-material/Redo'

interface Props {
  editor: Editor
}

/**
 * Formatierungs-Toolbar für den Wiki-Editor.
 * Greift direkt auf das Editor-API zu und reflektiert den aktuellen
 * Auswahlstatus (active-Hervorhebung) über editor.isActive().
 */
export function EditorToolbar({ editor }: Props) {
  const [headingAnchor, setHeadingAnchor] = useState<HTMLElement | null>(null)

  // Heading-Label für Button
  const headingLabel = editor.isActive('heading', { level: 1 }) ? 'Titel 1'
    : editor.isActive('heading', { level: 2 }) ? 'Titel 2'
    : editor.isActive('heading', { level: 3 }) ? 'Titel 3'
    : 'Text'

  const btn = (opts: {
    icon: React.ReactNode
    title: string
    active?: boolean
    onClick: () => void
    disabled?: boolean
  }) => (
    <Tooltip title={opts.title}>
      <span>
        <IconButton
          size="small"
          onClick={opts.onClick}
          disabled={opts.disabled}
          sx={{
            borderRadius: 1,
            bgcolor: opts.active ? 'action.selected' : 'transparent',
            color: opts.active ? 'primary.main' : 'text.secondary',
          }}
        >
          {opts.icon}
        </IconButton>
      </span>
    </Tooltip>
  )

  const divider = <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />

  const promptLink = () => {
    const previous = editor.getAttributes('link').href ?? ''
    const url = window.prompt('URL:', previous)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        mb: 2,
        py: 0.5,
        px: 0.5,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.25,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Heading-Dropdown */}
      <Button
        size="small"
        onClick={(e) => setHeadingAnchor(e.currentTarget)}
        endIcon={<ArrowDropDownIcon />}
        sx={{
          textTransform: 'none',
          color: 'text.secondary',
          minWidth: 90,
          justifyContent: 'space-between',
        }}
      >
        {headingLabel}
      </Button>
      <Menu
        anchorEl={headingAnchor}
        open={Boolean(headingAnchor)}
        onClose={() => setHeadingAnchor(null)}
      >
        <MenuItem onClick={() => { editor.chain().focus().setParagraph().run(); setHeadingAnchor(null) }}>
          Text
        </MenuItem>
        <MenuItem onClick={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); setHeadingAnchor(null) }}>
          <Box component="span" sx={{ fontSize: 18, fontWeight: 700 }}>Überschrift 1</Box>
        </MenuItem>
        <MenuItem onClick={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); setHeadingAnchor(null) }}>
          <Box component="span" sx={{ fontSize: 16, fontWeight: 700 }}>Überschrift 2</Box>
        </MenuItem>
        <MenuItem onClick={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setHeadingAnchor(null) }}>
          <Box component="span" sx={{ fontSize: 14, fontWeight: 600 }}>Überschrift 3</Box>
        </MenuItem>
      </Menu>

      {divider}

      {btn({ icon: <FormatBoldIcon fontSize="small" />, title: 'Fett (Strg+B)',
        active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run() })}
      {btn({ icon: <FormatItalicIcon fontSize="small" />, title: 'Kursiv (Strg+I)',
        active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run() })}
      {btn({ icon: <FormatUnderlinedIcon fontSize="small" />, title: 'Unterstrichen (Strg+U)',
        active: editor.isActive('underline'), onClick: () => editor.chain().focus().toggleUnderline().run() })}
      {btn({ icon: <StrikethroughSIcon fontSize="small" />, title: 'Durchgestrichen',
        active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() })}
      {btn({ icon: <CodeIcon fontSize="small" />, title: 'Inline-Code',
        active: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run() })}

      {divider}

      {btn({ icon: <FormatListBulletedIcon fontSize="small" />, title: 'Aufzählung',
        active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run() })}
      {btn({ icon: <FormatListNumberedIcon fontSize="small" />, title: 'Nummerierte Liste',
        active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run() })}
      {btn({ icon: <CheckBoxOutlinedIcon fontSize="small" />, title: 'Aufgabenliste',
        active: editor.isActive('taskList'), onClick: () => editor.chain().focus().toggleTaskList().run() })}
      {btn({ icon: <FormatQuoteIcon fontSize="small" />, title: 'Zitat',
        active: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run() })}

      {divider}

      {btn({ icon: <FormatAlignLeftIcon fontSize="small" />, title: 'Linksbündig',
        active: editor.isActive({ textAlign: 'left' }), onClick: () => editor.chain().focus().setTextAlign('left').run() })}
      {btn({ icon: <FormatAlignCenterIcon fontSize="small" />, title: 'Zentriert',
        active: editor.isActive({ textAlign: 'center' }), onClick: () => editor.chain().focus().setTextAlign('center').run() })}
      {btn({ icon: <FormatAlignRightIcon fontSize="small" />, title: 'Rechtsbündig',
        active: editor.isActive({ textAlign: 'right' }), onClick: () => editor.chain().focus().setTextAlign('right').run() })}
      {btn({ icon: <FormatAlignJustifyIcon fontSize="small" />, title: 'Blocksatz',
        active: editor.isActive({ textAlign: 'justify' }), onClick: () => editor.chain().focus().setTextAlign('justify').run() })}

      {divider}

      {btn({ icon: <LinkIcon fontSize="small" />, title: 'Link', active: editor.isActive('link'), onClick: promptLink })}
      {btn({ icon: <HorizontalRuleIcon fontSize="small" />, title: 'Trennlinie',
        onClick: () => editor.chain().focus().setHorizontalRule().run() })}

      <Box sx={{ flex: 1 }} />

      {btn({ icon: <UndoIcon fontSize="small" />, title: 'Rückgängig (Strg+Z)',
        disabled: !editor.can().undo(), onClick: () => editor.chain().focus().undo().run() })}
      {btn({ icon: <RedoIcon fontSize="small" />, title: 'Wiederherstellen (Strg+Y)',
        disabled: !editor.can().redo(), onClick: () => editor.chain().focus().redo().run() })}
    </Box>
  )
}
