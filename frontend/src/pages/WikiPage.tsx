import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import InputBase from '@mui/material/InputBase'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import Popover from '@mui/material/Popover'
import Button from '@mui/material/Button'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline'
import CloudSyncIcon from '@mui/icons-material/CloudSync'
import SearchIcon from '@mui/icons-material/Search'
import LockIcon from '@mui/icons-material/Lock'
import FolderIcon from '@mui/icons-material/Folder'
import EditIcon from '@mui/icons-material/Edit'
import VisibilityIcon from '@mui/icons-material/Visibility'
import { useSession } from '../context/SessionContext'
import {
  useWikiTree, useWikiPage, useCreateWikiPage, useUpdateWikiPage, useDeleteWikiPage,
  type WikiPageNode,
} from '../features/wiki/queries'
import { WikiTree } from '../components/wiki/WikiTree'
import { WikiEditor } from '../components/wiki/WikiEditor'
import { WikiSearchDialog } from '../components/wiki/WikiSearchDialog'
import { WikiPermissionsDialog } from '../components/wiki/WikiPermissionsDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { apiFetch } from '../lib/api'

// Emoji-Picker ist groß → lazy, damit die Hauptseite schnell öffnet
const EmojiPicker = lazy(() => import('emoji-picker-react'))

export function WikiPage() {
  const { hasPermission } = useSession()
  const canCreate = hasPermission('wiki:create')
  const canDelete = hasPermission('wiki:delete')

  const { data: treeData } = useWikiTree()
  const pages: WikiPageNode[] = useMemo(() => treeData ?? [], [treeData])

  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (selectedId || pages.length === 0) return
    const firstRoot = pages.find((p) => !p.parentId) ?? pages[0]
    if (firstRoot) setSelectedId(firstRoot.id)
  }, [pages, selectedId])

  const { data: page, isLoading } = useWikiPage(selectedId ?? undefined)
  const createMut = useCreateWikiPage()
  const updateMut = useUpdateWikiPage(selectedId ?? '')
  const deleteMut = useDeleteWikiPage()
  const canUpdate = page?.canEdit === true

  // Bearbeitungsmodus: Standardmäßig Lese-Modus, damit man nicht aus Versehen
  // etwas ändert. Über den Stift-Button wechselt man in den Schreib-Modus.
  // Beim Seitenwechsel immer zurück auf View.
  const [editMode, setEditMode] = useState(false)
  useEffect(() => { setEditMode(false) }, [selectedId])
  const isEditing = canUpdate && editMode
  // Getrennte Mutation für Moves (andere ID als die aktuell selektierte)
  const moveWikiPage = async (id: string, parentId: string | null, sortOrder: number) => {
    await apiFetch(`/wiki/pages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId, sortOrder }),
    })
  }

  const [title, setTitle] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const contentBufferRef = useRef<unknown>(null)
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (page) {
      setTitle(page.title)
      setIcon(page.icon)
      contentBufferRef.current = page.content
      setDirty(false)
      setSavedAt(new Date(page.updatedAt))
    }
  }, [page?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = () => {
    if (!selectedId || !isEditing) return
    setDirty(true)
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      await updateMut.mutateAsync({
        title,
        icon,
        content: contentBufferRef.current,
      })
      setDirty(false)
      setSavedAt(new Date())
    }, 800) as unknown as number
  }

  useEffect(() => {
    const handler = () => {
      if (dirty && selectedId && isEditing) {
        updateMut.mutate({ title, icon, content: contentBufferRef.current })
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, title, icon, selectedId])

  const handleAddChild = async (parentId: string | null, type: 'PAGE' | 'FOLDER' = 'PAGE') => {
    const newPage = await createMut.mutateAsync({
      title: type === 'FOLDER' ? 'Neuer Ordner' : 'Neue Seite',
      parentId,
      type,
    })
    setSelectedId(newPage.id)
  }

  const [permPageId, setPermPageId] = useState<string | null>(null)
  const permPage = useMemo(
    () => pages.find((p) => p.id === permPageId) ?? null,
    [pages, permPageId],
  )

  const [confirmDelete, setConfirmDelete] = useState(false)
  const handleDelete = async () => {
    if (!selectedId) return
    await deleteMut.mutateAsync(selectedId)
    setSelectedId(null)
    setConfirmDelete(false)
  }

  // ⌘K / Ctrl+K öffnet die Suche
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Emoji-Picker
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null)

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 112px)', gap: 0 }}>
      <Paper
        elevation={0}
        sx={{
          width: 280,
          minWidth: 280,
          borderRight: '1px solid',
          borderColor: 'divider',
          p: 1,
          overflowY: 'auto',
          borderRadius: 0,
          bgcolor: 'background.paper',
        }}
      >
        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={<SearchIcon />}
          onClick={() => setSearchOpen(true)}
          sx={{ justifyContent: 'flex-start', mb: 1, textTransform: 'none', color: 'text.secondary' }}
        >
          Suchen <Box component="span" sx={{ ml: 'auto', fontSize: 11, opacity: 0.7 }}>⌘K</Box>
        </Button>

        <WikiTree
          pages={pages}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onAddChild={canCreate ? handleAddChild : undefined}
          onMove={moveWikiPage}
          onOpenPermissions={(id) => setPermPageId(id)}
          canCreate={canCreate}
          canUpdate={canUpdate}
        />
      </Paper>

      <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, md: 6 }, py: 4 }}>
        {!selectedId ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' }}>
            <Typography>
              {canCreate
                ? 'Wähle links eine Seite oder lege eine neue an.'
                : 'Noch keine Seiten vorhanden.'}
            </Typography>
          </Box>
        ) : isLoading || !page ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ maxWidth: 820, mx: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <IconButton
                size="small"
                onClick={(e) => isEditing && setEmojiAnchor(e.currentTarget)}
                sx={{ fontSize: 28, width: 44, height: 44, p: 0 }}
                disabled={!isEditing}
              >
                {icon || <Box sx={{ color: 'text.disabled', fontSize: 20 }}>＋</Box>}
              </IconButton>
              <InputBase
                value={title}
                onChange={(e) => { setTitle(e.target.value); scheduleSave() }}
                placeholder="Unbenannt"
                readOnly={!isEditing}
                sx={{
                  flex: 1,
                  fontSize: 34,
                  fontWeight: 700,
                  '& input': { p: 0 },
                }}
              />
              {isEditing && (
                <Tooltip title={dirty ? 'Speichert …' : savedAt ? `Gespeichert ${savedAt.toLocaleTimeString('de-CH')}` : ''}>
                  <Box sx={{ color: dirty ? 'warning.main' : 'success.main', display: 'flex', alignItems: 'center' }}>
                    {dirty ? <CloudSyncIcon /> : <CheckCircleIcon />}
                  </Box>
                </Tooltip>
              )}
              {canUpdate && (
                <Tooltip title={isEditing ? 'Schreibschutz aktivieren' : 'Bearbeiten'}>
                  <IconButton
                    onClick={() => setEditMode((m) => !m)}
                    size="small"
                    color={isEditing ? 'primary' : 'default'}
                    sx={{
                      bgcolor: isEditing ? 'primary.main' : 'transparent',
                      color: isEditing ? 'primary.contrastText' : 'inherit',
                      '&:hover': { bgcolor: isEditing ? 'primary.dark' : 'action.hover' },
                    }}
                  >
                    {isEditing ? <VisibilityIcon /> : <EditIcon />}
                  </IconButton>
                </Tooltip>
              )}
              {canUpdate && (
                <Tooltip title="Zugriff verwalten">
                  <IconButton onClick={() => setPermPageId(page.id)} size="small">
                    <LockIcon />
                  </IconButton>
                </Tooltip>
              )}
              {canDelete && canUpdate && (
                <Tooltip title={page.type === 'FOLDER' ? 'Ordner löschen' : 'Seite löschen'}>
                  <IconButton onClick={() => setConfirmDelete(true)} size="small">
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Zuletzt bearbeitet {new Date(page.updatedAt).toLocaleString('de-CH')}
              {page.updatedBy && ` · ${page.updatedBy.firstName} ${page.updatedBy.lastName}`}
            </Typography>

            <Divider sx={{ mb: 3 }} />

            {page.type === 'FOLDER' ? (
              <FolderChildrenView
                pages={pages}
                folderId={page.id}
                onSelect={(id) => setSelectedId(id)}
                onAddChild={canCreate && canUpdate ? handleAddChild : undefined}
              />
            ) : (
              <WikiEditor
                key={page.id}
                content={page.content}
                editable={isEditing}
                onChange={(json) => { contentBufferRef.current = json; scheduleSave() }}
              />
            )}
          </Box>
        )}
      </Box>

      <Popover
        open={Boolean(emojiAnchor)}
        anchorEl={emojiAnchor}
        onClose={() => setEmojiAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 1 }}>
          <Button size="small" onClick={() => { setIcon(null); scheduleSave(); setEmojiAnchor(null) }}>
            Entfernen
          </Button>
          <Suspense fallback={<Box sx={{ p: 3 }}><CircularProgress size={20} /></Box>}>
            <EmojiPicker
              onEmojiClick={(data) => { setIcon(data.emoji); scheduleSave(); setEmojiAnchor(null) }}
              lazyLoadEmojis
              width={320}
              height={380}
            />
          </Suspense>
        </Box>
      </Popover>

      <WikiSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(id) => setSelectedId(id)}
      />

      <WikiPermissionsDialog
        open={Boolean(permPageId)}
        pageId={permPageId}
        pageTitle={permPage?.title ?? ''}
        onClose={() => setPermPageId(null)}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirmDelete}
        title="Seite löschen?"
        message="Die Seite und alle Unterseiten werden unwiderruflich gelöscht."
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        confirmLabel="Löschen"
      />
    </Box>
  )
}

/** Liste der direkten Kinder eines Ordners als Kachel-Übersicht. */
function FolderChildrenView({
  pages, folderId, onSelect, onAddChild,
}: {
  pages: WikiPageNode[]
  folderId: string
  onSelect: (id: string) => void
  onAddChild?: (parentId: string | null, type: 'PAGE' | 'FOLDER') => void
}) {
  const children = pages
    .filter((p) => p.parentId === folderId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))

  return (
    <Box>
      {children.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          Ordner ist leer.
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
          {children.map((c) => (
            <Box
              key={c.id}
              onClick={() => onSelect(c.id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1.5,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ fontSize: 22 }}>
                {c.icon ?? (c.type === 'FOLDER' ? <FolderIcon /> : '📄')}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap fontWeight={500}>{c.title || 'Unbenannt'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {c.type === 'FOLDER' ? 'Ordner' : 'Seite'} · {new Date(c.updatedAt).toLocaleDateString('de-CH')}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {onAddChild && (
        <Box sx={{ mt: 3, display: 'flex', gap: 1 }}>
          <Button variant="outlined" onClick={() => onAddChild(folderId, 'PAGE')}>+ Neue Seite</Button>
          <Button variant="outlined" onClick={() => onAddChild(folderId, 'FOLDER')}>+ Neuer Ordner</Button>
        </Box>
      )}
    </Box>
  )
}
