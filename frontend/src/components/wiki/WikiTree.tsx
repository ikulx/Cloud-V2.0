import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import type { WikiPageNode } from '../../features/wiki/queries'

interface WikiTreeProps {
  pages: WikiPageNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddChild?: (parentId: string | null) => void
  canCreate: boolean
}

interface Node extends WikiPageNode {
  children: Node[]
}

function buildTree(pages: WikiPageNode[]): Node[] {
  const map = new Map<string, Node>()
  for (const p of pages) map.set(p.id, { ...p, children: [] })
  const roots: Node[] = []
  for (const p of map.values()) {
    if (p.parentId && map.has(p.parentId)) {
      map.get(p.parentId)!.children.push(p)
    } else {
      roots.push(p)
    }
  }
  return roots
}

export function WikiTree({ pages, selectedId, onSelect, onAddChild, canCreate }: WikiTreeProps) {
  const tree = useMemo(() => buildTree(pages), [pages])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const renderNode = (node: Node, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(node.id)
    const isSelected = node.id === selectedId

    return (
      <Box key={node.id}>
        <Box
          onClick={() => onSelect(node.id)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            pl: 0.5 + depth * 1.25,
            pr: 0.5,
            py: 0.5,
            borderRadius: 1,
            cursor: 'pointer',
            bgcolor: isSelected ? 'action.selected' : 'transparent',
            '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
            '&:hover .wiki-tree-add': { opacity: 1 },
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); toggle(node.id) }}
            sx={{ p: 0.25, visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
          <Typography sx={{ flex: 1, fontSize: 14, userSelect: 'none' }} noWrap>
            {node.icon && <span style={{ marginRight: 6 }}>{node.icon}</span>}
            {node.title || 'Unbenannt'}
          </Typography>
          {canCreate && onAddChild && (
            <Tooltip title="Unterseite">
              <IconButton
                size="small"
                className="wiki-tree-add"
                sx={{ p: 0.25, opacity: 0, transition: 'opacity 120ms' }}
                onClick={(e) => { e.stopPropagation(); onAddChild(node.id); setExpanded((s) => new Set(s).add(node.id)) }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        {isOpen && hasChildren && (
          <Box>{node.children.map((c) => renderNode(c, depth + 1))}</Box>
        )}
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, px: 0.5 }}>
        <Typography variant="overline" color="text.secondary">Seiten</Typography>
        {canCreate && onAddChild && (
          <Tooltip title="Neue Seite auf oberster Ebene">
            <IconButton size="small" onClick={() => onAddChild(null)}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {tree.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>
          Noch keine Seiten.
        </Typography>
      ) : (
        tree.map((n) => renderNode(n, 0))
      )}
    </Box>
  )
}
