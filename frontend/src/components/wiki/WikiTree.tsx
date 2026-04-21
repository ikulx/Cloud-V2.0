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
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import {
  DndContext, pointerWithin, PointerSensor, useSensor, useSensors,
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

/** Prüft, ob `ancestorId` in der Eltern-Kette von `childId` (oder childId selbst) liegt. */
function isDescendant(pages: WikiPageNode[], childId: string, ancestorId: string): boolean {
  let cursor: string | null = childId
  const visited = new Set<string>()
  while (cursor && !visited.has(cursor)) {
    if (cursor === ancestorId) return true
    visited.add(cursor)
    const p = pages.find((x) => x.id === cursor)
    cursor = p?.parentId ?? null
  }
  return false
}

export function WikiTree({ pages, selectedId, onSelect, onAddChild, onMove, onOpenPermissions, onDuplicate, onDelete, canCreate, canUpdate }: WikiTreeProps) {
  const tree = useMemo(() => buildTree(pages), [pages])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [overId, setOverId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

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

    // Drop-Zonen: "root" | "inside:<id>" | "before:<id>" | "after:<id>"
    let newParentId: string | null
    let newSortOrder: number

    const listSorted = (parentId: string | null) =>
      pages
        .filter((p) => (p.parentId ?? null) === parentId && p.id !== draggedId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))

    if (overKey === 'root') {
      newParentId = null
      const siblings = listSorted(null)
      newSortOrder = (siblings[siblings.length - 1]?.sortOrder ?? 0) + 10
    } else if (overKey.startsWith('inside:')) {
      const parentId = overKey.slice('inside:'.length)
      if (parentId === draggedId) return
      if (isDescendant(pages, parentId, draggedId)) return
      newParentId = parentId
      const siblings = listSorted(parentId)
      newSortOrder = (siblings[siblings.length - 1]?.sortOrder ?? 0) + 10
    } else if (overKey.startsWith('before:') || overKey.startsWith('after:')) {
      const targetId = overKey.slice(overKey.indexOf(':') + 1)
      if (targetId === draggedId) return
      const target = pages.find((p) => p.id === targetId)
      if (!target) return
      if (isDescendant(pages, target.parentId ?? targetId, draggedId)) return
      newParentId = target.parentId ?? null
      const siblings = listSorted(newParentId)
      const idx = siblings.findIndex((p) => p.id === targetId)
      if (overKey.startsWith('before:')) {
        const prev = idx > 0 ? siblings[idx - 1] : null
        newSortOrder = prev
          ? (prev.sortOrder + target.sortOrder) / 2
          : target.sortOrder - 10
      } else {
        const next = idx < siblings.length - 1 ? siblings[idx + 1] : null
        newSortOrder = next
          ? (next.sortOrder + target.sortOrder) / 2
          : target.sortOrder + 10
      }
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
        <BetweenDropZone id={`before:${node.id}`} active={overId === `before:${node.id}`} depth={depth} enabled={canUpdate} />
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
        <BetweenDropZone id={`after:${node.id}`} active={overId === `after:${node.id}`} depth={depth} enabled={canUpdate} />
      </Box>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setOverId(null)}
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

        {canUpdate && <RootDropzone active={overId === 'root'} />}
      </Box>
    </DndContext>
  )
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
  // Drag: wir verteilen die Listener auf die gesamte Zeile – PointerSensor
  // mit distance:6 unterscheidet selbst zwischen "Klick" (Select) und "Drag".
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: node.id, disabled: !canEdit })
  // Drop: ganze Zeile ist "inside"-Ziel (→ Kind werden).
  const { setNodeRef: setDropRef } = useDroppable({ id: `inside:${node.id}`, disabled: !canEdit })
  const combinedRef = (el: HTMLDivElement | null) => { setDragRef(el); setDropRef(el) }

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  return (
    <Box
      ref={combinedRef}
      onClick={() => !node.canView ? null : onSelect(node.id)}
      {...attributes}
      {...(canEdit ? listeners : {})}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        pl: 0.5 + depth * 1.25,
        pr: 0.5,
        py: 0.5,
        borderRadius: 1,
        cursor: isDragging ? 'grabbing' : (node.canView ? 'grab' : 'not-allowed'),
        opacity: isDragging ? 0.4 : (node.canView ? 1 : 0.5),
        bgcolor: isOver ? 'action.focus' : isSelected ? 'action.selected' : 'transparent',
        outline: isOver ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
        '&:hover .wiki-tree-action': { opacity: 1 },
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {canEdit && (
        <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
      )}
      <IconButton
        size="small"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle(node.id) }}
        sx={{ p: 0.25, visibility: hasChildren || node.type === 'FOLDER' ? 'visible' : 'hidden' }}
      >
        {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      </IconButton>
      {!node.icon && (
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary', mr: 0.25 }}>
          {node.type === 'FOLDER'
            ? (isOpen ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />)
            : <ArticleIcon fontSize="small" />}
        </Box>
      )}
      <Typography sx={{ flex: 1, fontSize: 14 }} noWrap>
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
            onPointerDown={(e) => e.stopPropagation()}
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
          onPointerDown={(e) => e.stopPropagation()}
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

/** Sehr schmale Drop-Zone zwischen zwei Zeilen – aktiv nur während des Drags. */
function BetweenDropZone({ id, active, depth, enabled }: { id: string; active: boolean; depth: number; enabled: boolean }) {
  const { setNodeRef } = useDroppable({ id, disabled: !enabled })
  return (
    <Box
      ref={setNodeRef}
      sx={{
        height: 4,
        marginLeft: `${0.5 + depth * 1.25}rem`,
        marginRight: '4px',
        position: 'relative',
        pointerEvents: enabled ? 'auto' : 'none',
      }}
    >
      {active && (
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 3,
            bgcolor: 'primary.main',
            borderRadius: 1,
            boxShadow: '0 0 0 2px rgba(25,118,210,0.35)',
          }}
        />
      )}
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
