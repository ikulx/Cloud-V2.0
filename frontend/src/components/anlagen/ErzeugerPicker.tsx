import { useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import Autocomplete from '@mui/material/Autocomplete'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import InputAdornment from '@mui/material/InputAdornment'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import SearchIcon from '@mui/icons-material/Search'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import FolderIcon from '@mui/icons-material/Folder'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import ArticleIcon from '@mui/icons-material/Article'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useErzeugerCategories, type ErzeugerType } from '../../features/erzeuger-types/queries'
import {
  buildCategoryTree, flattenTypes, formatCategoryPath,
  type ErzeugerTreeNode,
} from '../../features/erzeuger-types/helpers'

export interface ErzeugerEntry {
  typeId: string
  serialNumber: string
}

interface Props {
  value: ErzeugerEntry[]
  onChange: (v: ErzeugerEntry[]) => void
  showErrors?: boolean
  disabled?: boolean
}

/**
 * Editor für die Erzeuger einer Anlage. Pro Zeile:
 *  - Autocomplete mit Volltextsuche über alle Typen (Label = Kategorie-Pfad › Typ)
 *  - Alternativ Browse-Button, der einen Baum-Dialog öffnet
 *  - Seriennummer-Feld mit per-Typ-Pflicht
 */
export function ErzeugerPicker({ value, onChange, showErrors, disabled }: Props) {
  const { data: categories = [] } = useErzeugerCategories()
  const allTypes = useMemo(() => flattenTypes(categories), [categories])

  const typeById = useMemo(() => {
    const m = new Map<string, ErzeugerType>()
    for (const t of allTypes) m.set(t.id, t)
    return m
  }, [allTypes])

  // Options für Autocomplete: jeder aktive Typ mit Pfad-Label
  const searchOptions = useMemo(() => {
    return allTypes
      .filter((t) => t.isActive)
      .map((t) => ({
        id: t.id,
        type: t,
        pathLabel: formatCategoryPath(t.categoryId, categories),
        searchText: `${formatCategoryPath(t.categoryId, categories, ' ')} ${t.name}`.toLowerCase(),
      }))
  }, [allTypes, categories])

  const [browseOpenIdx, setBrowseOpenIdx] = useState<number | null>(null)

  const updateRow = (idx: number, patch: Partial<ErzeugerEntry>) => {
    const next = value.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  const remove = (idx: number) => {
    const next = value.slice()
    next.splice(idx, 1)
    onChange(next)
  }
  const add = () => {
    onChange([...value, { typeId: '', serialNumber: '' }])
  }

  const hasNoOptions = searchOptions.length === 0

  return (
    <Box>
      {value.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Noch kein Erzeuger hinzugefügt.
        </Typography>
      )}

      {value.map((row, idx) => {
        const t = typeById.get(row.typeId) ?? null
        const serialRequired = t?.serialRequired ?? true
        const serialInvalid = showErrors && serialRequired && !row.serialNumber.trim()
        const selectedOption = searchOptions.find((o) => o.id === row.typeId) ?? null
        // Falls der Typ inzwischen deaktiviert/entfernt wurde, trotzdem einen
        // Pseudo-Eintrag anzeigen, damit der User sieht was hängt.
        const legacyLabel = t && !selectedOption
          ? `${formatCategoryPath(t.categoryId, categories)} › ${t.name}`
          : ''

        return (
          <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Autocomplete
              sx={{ minWidth: 320, flex: 1 }}
              size="small"
              disabled={disabled || hasNoOptions}
              options={searchOptions}
              value={selectedOption}
              onChange={(_, val) => updateRow(idx, { typeId: val?.id ?? '' })}
              getOptionLabel={(o) => (o.pathLabel ? `${o.pathLabel} › ${o.type.name}` : o.type.name)}
              filterOptions={(opts, state) => {
                const q = state.inputValue.trim().toLowerCase()
                if (!q) return opts
                return opts.filter((o) => o.searchText.includes(q))
              }}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderOption={(props, o) => (
                <li {...props} key={o.id}>
                  <Box>
                    <Typography variant="body2">{o.type.name}</Typography>
                    {o.pathLabel && (
                      <Typography variant="caption" color="text.secondary">
                        {o.pathLabel}
                      </Typography>
                    )}
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Erzeuger"
                  placeholder={legacyLabel || 'Suchen oder durchstöbern …'}
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                    endAdornment: (
                      <>
                        <Tooltip title="Im Baum auswählen">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setBrowseOpenIdx(idx) }}>
                            <AccountTreeIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
            <TextField
              size="small"
              label={'Seriennummer' + (serialRequired ? ' *' : '')}
              value={row.serialNumber}
              onChange={(e) => updateRow(idx, { serialNumber: e.target.value })}
              error={serialInvalid}
              helperText={serialInvalid ? 'Pflichtfeld für diesen Typ' : ''}
              disabled={disabled}
              sx={{ minWidth: 180, flex: 1 }}
            />
            <Tooltip title="Entfernen">
              <IconButton onClick={() => remove(idx)} size="small" disabled={disabled}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )
      })}

      <Button
        startIcon={<AddIcon />}
        onClick={add}
        size="small"
        variant="outlined"
        disabled={disabled || hasNoOptions}
      >
        Erzeuger hinzufügen
      </Button>
      {hasNoOptions && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Noch keine aktiven Erzeuger-Typen im Katalog. In den Einstellungen → Erzeuger anlegen.
        </Typography>
      )}

      {browseOpenIdx !== null && (
        <TreeBrowseDialog
          open
          onClose={() => setBrowseOpenIdx(null)}
          onSelect={(typeId) => { updateRow(browseOpenIdx, { typeId }); setBrowseOpenIdx(null) }}
        />
      )}
    </Box>
  )
}

/** Baum-basierter Auswahl-Dialog als Alternative zur Textsuche. */
function TreeBrowseDialog({
  open, onClose, onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (typeId: string) => void
}) {
  const { data: categories = [] } = useErzeugerCategories()
  const tree = useMemo(() => buildCategoryTree(categories.filter((c) => c.isActive)), [categories])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Beim Öffnen top-level einmal aufklappen
  const rootIds = tree.map((n) => n.category.id).join(',')
  useEffect(() => {
    setExpanded(new Set(tree.map((n) => n.category.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootIds])

  const toggle = (id: string) => {
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const render = (node: ErzeugerTreeNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.category.id)
    const hasChildren = node.children.length > 0 || node.types.length > 0
    return (
      <Box key={node.category.id}>
        <Box
          onClick={() => toggle(node.category.id)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            pl: 0.5 + depth * 2, py: 0.75,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <IconButton size="small" sx={{ p: 0.25, visibility: hasChildren ? 'visible' : 'hidden' }}>
            {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
          {isOpen ? <FolderOpenIcon fontSize="small" sx={{ color: 'primary.main' }} />
                  : <FolderIcon fontSize="small" sx={{ color: 'primary.main' }} />}
          <Typography sx={{ fontWeight: 500 }}>{node.category.name}</Typography>
        </Box>
        {isOpen && (
          <Box>
            {node.children.map((c) => render(c, depth + 1))}
            {node.types.filter((t) => t.isActive).map((t) => (
              <Box
                key={t.id}
                onClick={() => onSelect(t.id)}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5,
                  pl: 0.5 + (depth + 1) * 2 + 2, py: 0.5,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.selected' },
                }}
              >
                <ArticleIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <Typography variant="body2">{t.name}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Erzeuger auswählen</DialogTitle>
      <DialogContent dividers sx={{ p: 0, maxHeight: 500 }}>
        {tree.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            Katalog ist leer.
          </Typography>
        ) : (
          <Box>{tree.map((n) => render(n, 0))}</Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  )
}

