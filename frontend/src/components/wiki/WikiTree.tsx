import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ArticleIcon from '@mui/icons-material/Article'
import LockIcon from '@mui/icons-material/Lock'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import type { WikiPageNode } from '../../features/wiki/queries'

interface WikiTreeProps {
  pages: WikiPageNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAddChild?: (parentId: string | null, type: 'PAGE' | 'FOLDER') => void
  onMove?: (id: string, newParentId: string | null, newSortOrder: number) => void
  onOpenPermissions?: (pageId: string) => void
  onDuplicate?: (pageId: string) => void
  onDelete?: (pageId: string) => void
  canCreate: boolean
  canUpdate: boolean
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
  const sortRec = (list: Node[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    list.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

export function WikiTree({ pages, selectedId, onSelect, onAddChild, onMove, onOpenPermissions, onDuplicate, onDelete, canCreate, canUpdate }: WikiTreeProps) {
  const tree = useMemo(() => buildTree(pages), [pages])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [overId, setOverId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const toggle = (id: string) => {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const handleDragOver = (e: DragOverEvent) => {
    setOverId(e.over?.id ? String(e.over.id) : null)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    setOverId(null)
    const { active, over } = e
    if (!over || !onMove) return
    const draggedId = String(active.id)
    const overKey = String(over.id)

    if (draggedId === overKey) return

    // Drop-Zones: "inside:<id>" oder "root"
    let newParentId: string | null
    let newSortOrder: number

    if (overKey === 'root') {
      newParentId = null
      const rootSiblings = pages.filter((p) => !p.parentId && p.id !== draggedId)
      const maxOrder = rootSiblings.reduce((m, p) => Math.max(m, p.sortOrder), 0)
      newSortOrder = maxOrder + 10
    } else if (overKey.startsWith('inside:')) {
      const parentId = overKey.slice('inside:'.length)
      if (parentId === draggedId) return
      // Zyklus-Schutz: darf nicht auf eigenen Nachfahren abgelegt werden
      if (isDescendant(pages, parentId, draggedId)) return
      newParentId = parentId
      const siblings = pages.filter((p) => p.parentId === parentId && p.id !== draggedId)
      const maxOrder = siblings.reduce((m, p) => Math.max(m, p.sortOrder), 0)
      newSortOrder = maxOrder + 10
    } else {
      return
    }

    onMove(draggedId, newParentId, newSortOrder)
  }

  const renderNode = (node: Node, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(node.id)
    const isSelected = node.id === selectedId
    return (
      <Box key={node.id}>
        <TreeRow
          node={node}
          depth={depth}
          hasChildren={hasChildren}
          isOpen={isOpen}
          isSelected={isSelected}
          isOver={overId === `inside:${node.id}`}
          onSelect={onSelect}
          onToggle={toggle}
          onAddChild={onAddChild ? (id, type) => { onAddChild(id, type); setExpanded((s) => new Set(s).add(id)) } : undefined}
          onOpenPermissions={onOpenPermissions}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
        {isOpen && hasChildren && <Box>{node.children.map((c) => renderNode(c, depth + 1))}</Box>}
      </Box>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5, px: 0.5 }}>
          <Typography variant="overline" color="text.secondary">Seiten</Typography>
          {canCreate && onAddChild && (
            <Box sx={{ display: 'flex', gap: 0.25 }}>
              <Tooltip title="Neuer Ordner (Wurzel)">
                <IconButton size="small" onClick={() => onAddChild(null, 'FOLDER')}>
                  <CreateNewFolderIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Neue Seite (Wurzel)">
                <IconButton size="small" onClick={() => onAddChild(null, 'PAGE')}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>

        {tree.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 2 }}>
            Noch keine Seiten.
          </Typography>
        ) : (
          tree.map((n) => renderNode(n, 0))
        )}

        {/* Drop-Zone für "auf Wurzel-Ebene verschieben" */}
        {canUpdate && <RootDropzone active={overId === 'root'} />}
      </Box>
    </DndContext>
  )
}

function isDescendant(pages: WikiPageNode[], candidateChildId: string, ancestorId: string): boolean {
  let cursor: string | null = candidateChildId
  while (cursor) {
    if (cursor === ancestorId) return true
    const p = pages.find((x) => x.id === cursor)
    cursor = p?.parentId ?? null
  }
  return false
}

interface TreeRowProps {
  node: Node
  depth: number
  hasChildren: boolean
  isOpen: boolean
  isSelected: boolean
  isOver: boolean
  onSelect: (id: string) => void
  onToggle: (id: string) => void
  onAddChild?: (id: string, type: 'PAGE' | 'FOLDER') => void
  onOpenPermissions?: (id: string) => void
  onDuplicate?: (id: string) => void
  onDelete?: (id: string) => void
}

function TreeRow({ node, depth, hasChildren, isOpen, isSelected, isOver, onSelect, onToggle, onAddChild, onOpenPermissions, onDuplicate, onDelete }: TreeRowProps) {
  const canEdit = node.canEdit
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: node.id, disabled: !canEdit })
  const { setNodeRef: setDropRef } = useDroppable({ id: `inside:${node.id}`, disabled: !canEdit })
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  // Ein DOM-Knoten muss sowohl draggable (für Listener) als auch droppable sein.
  const combinedRef = (el: HTMLDivElement | null) => { setDragRef(el); setDropRef(el) }

  return (
    <Box
      ref={combinedRef}
      onClick={() => !node.canView ? null : onSelect(node.id)}
      {...attributes}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pl: 0.5 + depth * 1.25,
        pr: 0.5,
        py: 0.5,
        borderRadius: 1,
        cursor: node.canView ? 'pointer' : 'not-allowed',
        opacity: isDragging ? 0.4 : (node.canView ? 1 : 0.5),
        bgcolor: isOver ? 'action.focus' : isSelected ? 'action.selected' : 'transparent',
        outline: isOver ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
        '&:hover .wiki-tree-action': { opacity: 1 },
      }}
    >
      {canEdit && (
        <Box
          {...listeners}
          className="wiki-tree-action"
          sx={{ display: 'flex', alignItems: 'center', cursor: 'grab', opacity: 0, transition: 'opacity 120ms' }}
          onClick={(e) => e.stopPropagation()}
        >
          <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled' }} />
        </Box>
      )}
      <IconButton
        size="small"
        onClick={(e) => { e.stopPropagation(); onToggle(node.id) }}
        sx={{ p: 0.25, visibility: hasChildren || node.type === 'FOLDER' ? 'visible' : 'hidden' }}
      >
        {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      </IconButton>
      {/* Typ-Icon: Ordner oder Seite. Eigenes Emoji-Icon (node.icon) geht vor. */}
      {!node.icon && (
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary', mr: 0.25 }}>
          {node.type === 'FOLDER'
            ? (isOpen ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />)
            : <ArticleIcon fontSize="small" />}
        </Box>
      )}
      <Typography sx={{ flex: 1, fontSize: 14, userSelect: 'none' }} noWrap>
        {node.icon && <span style={{ marginRight: 6 }}>{node.icon}</span>}
        {node.title || 'Unbenannt'}
      </Typography>
      {!node.canView && (
        <LockIcon fontSize="small" sx={{ color: 'text.disabled' }} />
      )}
      {canEdit && onAddChild && (
        <Tooltip title="Unterseite">
          <IconButton
            size="small"
            className="wiki-tree-action"
            sx={{ p: 0.25, opacity: 0, transition: 'opacity 120ms' }}
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id, 'PAGE') }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {canEdit && (
        <IconButton
          size="small"
          className="wiki-tree-action"
          sx={{ p: 0.25, opacity: 0, transition: 'opacity 120ms' }}
          onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      )}

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        onClick={(e) => e.stopPropagation()}
      >
        {onAddChild && (
          <MenuItem onClick={() => { onAddChild(node.id, 'PAGE'); setMenuAnchor(null) }}>
            <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Neue Seite</ListItemText>
          </MenuItem>
        )}
        {onAddChild && (
          <MenuItem onClick={() => { onAddChild(node.id, 'FOLDER'); setMenuAnchor(null) }}>
            <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Neuer Ordner</ListItemText>
          </MenuItem>
        )}
        {onDuplicate && (
          <MenuItem onClick={() => { onDuplicate(node.id); setMenuAnchor(null) }}>
            <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Duplizieren</ListItemText>
          </MenuItem>
        )}
        {onOpenPermissions && (
          <MenuItem onClick={() => { onOpenPermissions(node.id); setMenuAnchor(null) }}>
            <ListItemIcon><LockIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Zugriff …</ListItemText>
          </MenuItem>
        )}
        {onDelete && (
          <MenuItem
            onClick={() => { onDelete(node.id); setMenuAnchor(null) }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>Löschen</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Box>
  )
}

function RootDropzone({ active }: { active: boolean }) {
  const { setNodeRef } = useDroppable({ id: 'root' })
  return (
    <Box
      ref={setNodeRef}
      sx={{
        mt: 1,
        px: 1,
        py: 1,
        borderRadius: 1,
        border: '1px dashed',
        borderColor: active ? 'primary.main' : 'transparent',
        color: 'text.disabled',
        fontSize: 12,
        textAlign: 'center',
        minHeight: 28,
      }}
    >
      {active ? 'Loslassen für oberste Ebene' : ''}
    </Box>
  )
}
