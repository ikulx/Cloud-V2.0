import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import Paper from '@mui/material/Paper'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import type { Editor, Range } from '@tiptap/core'

export interface SlashItem {
  title: string
  description: string
  keywords: string[]
  command: (args: { editor: Editor; range: Range }) => void
}

interface SlashMenuListProps {
  items: SlashItem[]
  command: (item: SlashItem) => void
}

export const SlashMenuList = forwardRef<{ onKeyDown: (e: KeyboardEvent) => boolean }, SlashMenuListProps>(
  function SlashMenuList({ items, command }, ref) {
    const [selected, setSelected] = useState(0)

    useEffect(() => setSelected(0), [items])

    const selectItem = (idx: number) => {
      const item = items[idx]
      if (item) command(item)
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          selectItem(selected)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <Paper elevation={6} sx={{ width: 280, p: 2 }}>
          <Typography variant="body2" color="text.secondary">Keine Treffer</Typography>
        </Paper>
      )
    }

    return (
      <Paper elevation={6} sx={{ width: 280, maxHeight: 320, overflowY: 'auto' }}>
        <List dense disablePadding>
          {items.map((item, idx) => (
            <ListItemButton
              key={item.title}
              selected={idx === selected}
              onClick={() => selectItem(idx)}
              sx={{ py: 0.75 }}
            >
              <ListItemText
                primary={item.title}
                secondary={item.description}
                primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                secondaryTypographyProps={{ fontSize: 12 }}
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>
    )
  },
)
