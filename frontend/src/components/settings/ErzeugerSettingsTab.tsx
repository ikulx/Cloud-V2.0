import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { apiPatch } from '../../lib/api'
import {
  useErzeugerCategories, useCreateErzeugerCategory, useDeleteErzeugerCategory,
  useCreateErzeugerType, useDeleteErzeugerType,
  type ErzeugerCategory, type ErzeugerType,
} from '../../features/erzeuger-types/queries'
import { buildCategoryTree, formatCategoryPath } from '../../features/erzeuger-types/helpers'

/**
 * Baum-basierter Katalog-Editor. Ordner sind beliebig verschachtelbar;
 * jeder Knoten kann eigene Erzeuger-Typen enthalten. Pro Typ kann per
 * Schalter bestimmt werden, ob die Seriennummer beim Zuweisen zur
 * Anlage obligatorisch ist (Default: ja).
 */
export function ErzeugerSettingsTab() {
  const { data: categories = [] } = useErzeugerCategories()
  const createCat = useCreateErzeugerCategory()
  const deleteCat = useDeleteErzeugerCategory()
  const createType = useCreateErzeugerType()
  const deleteType = useDeleteErzeugerType()
  const qc = useQueryClient()

  const tree = useMemo(() => buildCategoryTree(categories), [categories])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newRootName, setNewRootName] = useState('')

  const toggle = (id: string) => {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const patchCategory = async (id: string, data: Partial<Pick<ErzeugerCategory, 'name' | 'parentId' | 'sortOrder' | 'isActive'>>) => {
    try {
      await apiPatch<ErzeugerCategory>(`/erzeuger-categories/${id}`, data)
      await qc.invalidateQueries({ queryKey: ['erzeuger-categories'] })
      await qc.invalidateQueries({ queryKey: ['erzeuger-types'] })
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' })
    }
  }
  const patchType = async (id: string, data: Partial<Pick<ErzeugerType, 'name' | 'isActive' | 'serialRequired' | 'categoryId'>>) => {
    try {
      await apiPatch<ErzeugerType>(`/erzeuger-types/${id}`, data)
      await qc.invalidateQueries({ queryKey: ['erzeuger-types'] })
      await qc.invalidateQueries({ queryKey: ['erzeuger-categories'] })
    } catch (e) {
      setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' })
    }
  }

  const addFolder = async (parentId: string | null) => {
    const name = window.prompt(parentId ? 'Name des Unterordners' : 'Name der neuen Kategorie')
    if (!name?.trim()) return
    setMsg(null)
    try {
      const lastOrder = parentId
        ? categories.filter((c) => c.parentId === parentId).reduce((m, c) => Math.max(m, c.sortOrder), 0)
        : categories.filter((c) => !c.parentId).reduce((m, c) => Math.max(m, c.sortOrder), 0)
      await createCat.mutateAsync({
        name: name.trim(),
        parentId,
        sortOrder: lastOrder + 10,
      })
      if (parentId) setExpanded((s) => new Set(s).add(parentId))
    } catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }

  const addType = async (categoryId: string) => {
    const name = window.prompt('Name des neuen Erzeuger-Typs')
    if (!name?.trim()) return
    setMsg(null)
    try {
      const cat = categories.find((c) => c.id === categoryId)
      const lastOrder = cat?.types.reduce((m, t) => Math.max(m, t.sortOrder), 0) ?? 0
      await createType.mutateAsync({
        name: name.trim(), categoryId, sortOrder: lastOrder + 10,
        serialRequired: true,
      })
      setExpanded((s) => new Set(s).add(categoryId))
    } catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }

  const removeFolder = async (id: string) => {
    setMsg(null)
    try { await deleteCat.mutateAsync(id) }
    catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }
  const removeType = async (id: string) => {
    setMsg(null)
    try { await deleteType.mutateAsync(id) }
    catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }

  const addRoot = async () => {
    if (!newRootName.trim()) return
    setMsg(null)
    try {
      const last = categories.filter((c) => !c.parentId).reduce((m, c) => Math.max(m, c.sortOrder), 0)
      await createCat.mutateAsync({ name: newRootName.trim(), parentId: null, sortOrder: last + 10 })
      setNewRootName('')
    } catch (e) { setMsg({ type: 'error', text: e instanceof Error ? e.message : 'Fehler' }) }
  }

  /** Für das Parent-Auswahlfeld beim Verschieben – alle Ordner mit Einrücken. */
  const flatFolderOptions = useMemo(() => {
    const out: { id: string; label: string; depth: number }[] = []
    const walk = (nodes: ReturnType<typeof buildCategoryTree>, depth: number) => {
      for (const n of nodes) {
        out.push({ id: n.category.id, label: `${'— '.repeat(depth)}${n.category.name}`, depth })
        walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }, [tree])

  const renderNode = (
    node: ReturnType<typeof buildCategoryTree>[number],
    depth: number,
  ): React.ReactNode => {
    const isOpen = expanded.has(node.category.id)
    const hasContent = node.children.length > 0 || node.types.length > 0
    const cat = node.category
    return (
      <Box key={cat.id}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            pl: 0.5 + depth * 2,
            py: 0.75,
            borderBottom: '1px solid',
            borderColor: 'divider',
            '&:hover .cat-actions': { opacity: 1 },
          }}
        >
          <IconButton
            size="small"
            onClick={() => toggle(cat.id)}
            sx={{ p: 0.25, visibility: hasContent ? 'visible' : 'hidden' }}
          >
            {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
          {isOpen ? <FolderOpenIcon fontSize="small" sx={{ color: 'primary.main' }} />
                  : <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />}

          {editingId === cat.id ? (
            <Box sx={{ display: 'flex', flex: 1, gap: 0.5, alignItems: 'center' }}>
              <TextField
                size="small"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { void patchCategory(cat.id, { name: editText.trim() }); setEditingId(null) } }}
              />
              <IconButton size="small" onClick={() => { void patchCategory(cat.id, { name: editText.trim() }); setEditingId(null) }}>
                <CheckIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setEditingId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <>
              <Typography sx={{ flex: 1, fontWeight: 500, opacity: cat.isActive ? 1 : 0.5 }}>
                {cat.name}
              </Typography>
              <Box className="cat-actions" sx={{ display: 'flex', gap: 0.25, opacity: 0, transition: 'opacity 120ms' }}>
                <Tooltip title="Unterordner"><IconButton size="small" onClick={() => addFolder(cat.id)}><CreateNewFolderIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Typ hinzufügen"><IconButton size="small" onClick={() => addType(cat.id)}><AddIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Umbenennen"><IconButton size="small" onClick={() => { setEditingId(cat.id); setEditText(cat.name) }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title={cat.isActive ? 'Deaktivieren' : 'Aktivieren'}>
                  <Switch size="small" checked={cat.isActive} onChange={(e) => void patchCategory(cat.id, { isActive: e.target.checked })} />
                </Tooltip>
                <TextField
                  select
                  size="small"
                  value={cat.parentId ?? ''}
                  onChange={(e) => void patchCategory(cat.id, { parentId: e.target.value || null })}
                  sx={{ minWidth: 140 }}
                  SelectProps={{ displayEmpty: true }}
                  title="Elternordner"
                >
                  <MenuItem value="">Wurzel</MenuItem>
                  {flatFolderOptions
                    .filter((o) => o.id !== cat.id)
                    .map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
                </TextField>
                <Tooltip title="Löschen"><IconButton size="small" onClick={() => removeFolder(cat.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </Box>
            </>
          )}
        </Box>

        {isOpen && (
          <Box>
            {/* Child-Ordner rekursiv */}
            {node.children.map((child) => renderNode(child, depth + 1))}
            {/* Typen-Liste */}
            {node.types.length > 0 && (
              <List dense disablePadding sx={{ pl: 0.5 + (depth + 1) * 2 }}>
                {node.types.map((t) => (
                  <ListItem
                    key={t.id}
                    sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 0.25 }}
                    secondaryAction={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        {editingId === t.id ? (
                          <>
                            <TextField
                              size="small"
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') { void patchType(t.id, { name: editText.trim() }); setEditingId(null) } }}
                            />
                            <IconButton size="small" onClick={() => { void patchType(t.id, { name: editText.trim() }); setEditingId(null) }}><CheckIcon fontSize="small" /></IconButton>
                            <IconButton size="small" onClick={() => setEditingId(null)}><CloseIcon fontSize="small" /></IconButton>
                          </>
                        ) : (
                          <>
                            <FormControlLabel
                              control={<Switch size="small" checked={t.serialRequired} onChange={(e) => void patchType(t.id, { serialRequired: e.target.checked })} />}
                              label={<Typography variant="caption">SN Pflicht</Typography>}
                              labelPlacement="start"
                              sx={{ mr: 0 }}
                            />
                            <Switch size="small" checked={t.isActive} onChange={(e) => void patchType(t.id, { isActive: e.target.checked })} />
                            <IconButton size="small" onClick={() => { setEditingId(t.id); setEditText(t.name) }}><EditIcon fontSize="small" /></IconButton>
                            <IconButton size="small" onClick={() => removeType(t.id)}><DeleteIcon fontSize="small" /></IconButton>
                          </>
                        )}
                      </Box>
                    }
                  >
                    <ListItemText
                      primary={t.name}
                      secondary={!t.isActive ? 'inaktiv' : undefined}
                      primaryTypographyProps={{ sx: { opacity: t.isActive ? 1 : 0.5, fontSize: 14 } }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Card sx={{ maxWidth: 960 }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 3 }}>
        <Typography variant="h6">Erzeuger-Katalog</Typography>
        <Typography variant="body2" color="text.secondary">
          Ordner können beliebig verschachtelt werden (z.B. „Wärmepumpe → Hersteller XY → Baureihe").
          Ein konkreter Erzeuger-Typ kann an jedem Knoten hängen und einzeln festlegen, ob die
          Seriennummer beim Hinzufügen zu einer Anlage obligatorisch ist.
        </Typography>

        {msg && <Alert severity={msg.type}>{msg.text}</Alert>}

        {/* Baum */}
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          {tree.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Noch kein Ordner angelegt.
            </Typography>
          ) : tree.map((n) => renderNode(n, 0))}
        </Box>

        {/* Neue Wurzel-Kategorie */}
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <TextField
            size="small"
            label="Neue Kategorie (Wurzel)"
            value={newRootName}
            onChange={(e) => setNewRootName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addRoot() }}
            fullWidth
          />
          <Button variant="contained" startIcon={<CreateNewFolderIcon />} onClick={addRoot} disabled={createCat.isPending}>
            Ordner
          </Button>
        </Box>

        <Typography variant="caption" color="text.secondary">
          Tipp: über die Symbole neben einem Ordner kannst du Unterordner (📁) oder Typen (＋) anlegen,
          den Elternordner ändern oder den Ordner löschen (geht nur, wenn er leer ist).
        </Typography>

        {/* Pfad-Vorschau für Orientierung */}
        {flatFolderOptions.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">Aktuelle Struktur:</Typography>
            <Box sx={{ pl: 2, mt: 0.5 }}>
              {flatFolderOptions.map((o) => (
                <Typography key={o.id} variant="caption" sx={{ display: 'block', fontFamily: 'monospace' }}>
                  {formatCategoryPath(o.id, categories)}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
