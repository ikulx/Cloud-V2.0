import { useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import SearchIcon from '@mui/icons-material/Search'
import Drawer from '@mui/material/Drawer'
import AddIcon from '@mui/icons-material/Add'
import MapIcon from '@mui/icons-material/Map'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WarningIcon from '@mui/icons-material/Warning'
import AssignmentLateIcon from '@mui/icons-material/AssignmentLate'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import FilterListIcon from '@mui/icons-material/FilterList'
import CloseIcon from '@mui/icons-material/Close'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import Menu from '@mui/material/Menu'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Divider from '@mui/material/Divider'
import { useNavigate } from 'react-router-dom'
import { useAnlagen, useDeleteAnlage } from '../features/anlagen/queries'
import { useUsers } from '../features/users/queries'
import { useGroups } from '../features/groups/queries'
import { useDevices } from '../features/devices/queries'
import { useErzeugerCategories } from '../features/erzeuger-types/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AnlageCreateWizard } from '../components/AnlageCreateWizard'
import {
  AnlagenFilterPanel, EMPTY_FILTERS, isFiltersEmpty,
  useAnlagenFacets, type AnlagenFilters,
} from '../components/anlagen/AnlagenFilterPanel'
import { usePermission } from '../hooks/usePermission'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useTranslation } from 'react-i18next'
import type { Anlage, Device } from '../types/model'

type AnlageStatus = 'OK' | 'TODO' | 'ERROR' | 'OFFLINE' | 'SUPPRESSED' | 'EMPTY'

function computeAnlageStatus(anlage: Anlage, devices: Device[]): AnlageStatus {
  if (devices.length === 0) return 'EMPTY'
  const hasOffline = devices.some((d) => d.status !== 'ONLINE')
  if (hasOffline) return 'OFFLINE'
  // Aktive Alarme = Störung an einem Gerät der Anlage. Vorrang vor
  // suppressed/TODO, weil ein laufender Alarm das wichtigste Signal ist.
  const activeAlarms = anlage._count?.alarmEvents ?? 0
  const hasError = activeAlarms > 0 || devices.some((d) => d.hasError === true)
  if (hasError) return 'ERROR'
  const anySuppressed = anlage.anlageDevices.some((ad) => ad.device.alarmsSuppressed === true)
  if (anySuppressed) return 'SUPPRESSED'
  const openTodos = anlage.todos
    ? anlage.todos.filter((t) => t.status === 'OPEN').length
    : (anlage._count?.todos ?? 0)
  if (openTodos > 0) return 'TODO'
  return 'OK'
}

function StatusChip({ status }: { status: AnlageStatus }) {
  const { t } = useTranslation()
  switch (status) {
    case 'OK':         return <Chip icon={<CheckCircleIcon />} label={t('anlagenList.statusOK')} color="success" size="small" sx={{ fontWeight: 600 }} />
    case 'TODO':       return <Chip icon={<AssignmentLateIcon />} label={t('anlagenList.statusTodo')} color="warning" size="small" sx={{ fontWeight: 600 }} />
    case 'ERROR':      return <Chip icon={<WarningIcon />} label={t('anlagenList.statusError')} color="warning" size="small" sx={{ fontWeight: 600, bgcolor: 'warning.dark', color: 'common.white' }} />
    case 'OFFLINE':    return <Chip icon={<ErrorIcon />} label={t('anlagenList.statusOffline')} color="error" size="small" sx={{ fontWeight: 600 }} />
    case 'SUPPRESSED': return <Chip icon={<NotificationsOffIcon />} label={t('anlagenList.statusSuppressed')} color="info" size="small" sx={{ fontWeight: 600 }} />
    case 'EMPTY':      return <Chip label="—" size="small" variant="outlined" />
  }
}

type SortKey = 'name' | 'projectNumber' | 'city' | 'updatedAt'

// ── Spalten-Definition ────────────────────────────────────────────────────
type ColumnKey =
  | 'status' | 'projectNumber' | 'name' | 'city' | 'erzeuger'
  | 'address' | 'country' | 'contactName' | 'contactEmail' | 'contactPhone'
  | 'deviceCount' | 'assignedUsers' | 'assignedGroups' | 'openTodos'
  | 'updatedAt'

interface ColumnDef {
  key: ColumnKey
  label: string
  defaultOn: boolean
  /** Name-Spalte kann nicht abgewählt werden. */
  alwaysOn?: boolean
  align?: 'left' | 'right'
  width?: number
}

const COLUMNS: ColumnDef[] = [
  { key: 'status',         label: 'Status',               defaultOn: true,  width: 140 },
  { key: 'projectNumber',  label: 'Projekt-Nr.',          defaultOn: true },
  { key: 'name',           label: 'Name',                 defaultOn: true, alwaysOn: true },
  { key: 'city',           label: 'Ort',                  defaultOn: true },
  { key: 'erzeuger',       label: 'Erzeuger',             defaultOn: true },
  { key: 'address',        label: 'Adresse',              defaultOn: false },
  { key: 'country',        label: 'Land',                 defaultOn: false },
  { key: 'contactName',    label: 'Verantwortlicher',     defaultOn: false },
  { key: 'contactEmail',   label: 'Kontakt-E-Mail',       defaultOn: false },
  { key: 'contactPhone',   label: 'Kontakt-Telefon',      defaultOn: false },
  { key: 'deviceCount',    label: 'Geräte',               defaultOn: false },
  { key: 'assignedUsers',  label: 'Benutzer-Zuweisungen', defaultOn: false },
  { key: 'assignedGroups', label: 'Gruppen-Zuweisungen',  defaultOn: false },
  { key: 'openTodos',      label: 'Offene Todos',         defaultOn: false },
  { key: 'updatedAt',      label: 'Aktualisiert',         defaultOn: false },
]

const COLUMNS_STORAGE_KEY = 'anlagen.columns'
function loadColumnsFromStorage(): Set<ColumnKey> {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as unknown
      if (Array.isArray(arr)) {
        const known = new Set(COLUMNS.map((c) => c.key))
        return new Set((arr as string[]).filter((k): k is ColumnKey => known.has(k as ColumnKey)))
      }
    }
  } catch { /* noop */ }
  return new Set(COLUMNS.filter((c) => c.defaultOn).map((c) => c.key))
}

export function AnlagenPage() {
  const { data: anlagen = [], isLoading } = useAnlagen()
  const { data: allUsers = [] } = useUsers()
  const { data: allGroups = [] } = useGroups()
  const { data: allDevices = [] } = useDevices()
  const { data: categories = [] } = useErzeugerCategories()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canCreate = usePermission('anlagen:create')
  const canDelete = usePermission('anlagen:delete')

  useDeviceStatus()

  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Anlage | null>(null)
  const [filters, setFilters] = useState<AnlagenFilters>(EMPTY_FILTERS)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => loadColumnsFromStorage())
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState<HTMLElement | null>(null)

  // Spalten-Auswahl in localStorage spiegeln – jeder User auf jedem Browser
  // behält seine eigene Auswahl.
  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(Array.from(visibleColumns)))
    } catch { /* noop */ }
  }, [visibleColumns])

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const orderedColumns = useMemo(() => {
    const selected = COLUMNS.filter((c) => c.alwaysOn || visibleColumns.has(c.key))
    return selected
  }, [visibleColumns])

  const deleteMutation = useDeleteAnlage()

  // Status pro Anlage in einer Map (stabil gegen Rerenders)
  const statusByAnlage = useMemo(() => {
    const m = new Map<string, AnlageStatus>()
    for (const a of anlagen) {
      const ids = new Set(a.anlageDevices.map((ad) => ad.device.id))
      const devs = allDevices.filter((d) => ids.has(d.id))
      m.set(a.id, computeAnlageStatus(a, devs))
    }
    return m
  }, [anlagen, allDevices])

  const facetCounts = useAnlagenFacets(
    anlagen,
    categories,
    (a) => statusByAnlage.get(a.id) ?? 'EMPTY',
  )

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase()
    const res = anlagen.filter((a) => {
      if (q) {
        const hay = [
          a.name, a.projectNumber, a.city, a.street, a.zip, a.country,
          a.contactName, a.contactEmail, a.contactPhone, a.contactMobile,
          ...(a.erzeuger?.map((e) => e.serialNumber ?? '') ?? []),
          ...(a.erzeuger?.map((e) => e.type.name) ?? []),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters.statuses.size > 0) {
        const s = statusByAnlage.get(a.id) ?? 'EMPTY'
        if (!filters.statuses.has(s)) return false
      }
      if (filters.categoryIds.size > 0) {
        // Die Anlage gehört zu Kategorie X, wenn einer ihrer Erzeuger-Typen
        // (direkt oder in einem Unter-Ordner) zu X gehört.
        const catsOfAnlage = new Set<string>()
        for (const e of a.erzeuger ?? []) {
          let cursor: string | null = e.type.id
          // Kategorie-Kette hochgehen
          const t = categories.flatMap((c) => c.types).find((x) => x.id === e.typeId)
          let catCursor = t?.categoryId ?? null
          while (catCursor) {
            catsOfAnlage.add(catCursor)
            const cat = categories.find((c) => c.id === catCursor)
            catCursor = cat?.parentId ?? null
          }
          void cursor
        }
        if (![...filters.categoryIds].some((id) => catsOfAnlage.has(id))) return false
      }
      if (filters.typeIds.size > 0) {
        const typeIds = new Set((a.erzeuger ?? []).map((e) => e.typeId))
        if (![...filters.typeIds].some((id) => typeIds.has(id))) return false
      }
      if (filters.cities.size > 0) {
        if (!a.city || !filters.cities.has(a.city)) return false
      }
      if (filters.userIds.size > 0) {
        const userIds = new Set((a.directUsers ?? []).map((du) => du.user.id))
        if (![...filters.userIds].some((id) => userIds.has(id))) return false
      }
      if (filters.groupIds.size > 0) {
        const groupIds = new Set((a.groupAnlagen ?? []).map((g) => g.group.id))
        if (![...filters.groupIds].some((id) => groupIds.has(id))) return false
      }
      if (filters.onlyOpenTodos) {
        const openTodos = a.todos
          ? a.todos.filter((tt) => tt.status === 'OPEN').length
          : (a._count?.todos ?? 0)
        if (openTodos === 0) return false
      }
      if (filters.onlyWithPhotos) {
        const hasPhotos = (a.todos ?? []).some((tt) => (tt.photoUrls?.length ?? 0) > 0)
          || (a.logEntries ?? []).some((l) => (l.photoUrls?.length ?? 0) > 0)
        if (!hasPhotos) return false
      }
      return true
    })

    const cmp = (a: Anlage, b: Anlage) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'projectNumber') {
        return (a.projectNumber ?? '').localeCompare(b.projectNumber ?? '') || a.name.localeCompare(b.name)
      }
      if (sortKey === 'city') {
        return (a.city ?? '').localeCompare(b.city ?? '') || a.name.localeCompare(b.name)
      }
      if (sortKey === 'updatedAt') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }
      return 0
    }
    return res.slice().sort(cmp)
  }, [anlagen, filters, sortKey, statusByAnlage, categories])

  if (isLoading) {
    return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  }

  const renderActiveFilterChips = () => {
    const chips: { key: string; label: string; onDelete: () => void }[] = []
    if (filters.search) chips.push({
      key: 'search', label: `Suche: "${filters.search}"`,
      onDelete: () => setFilters({ ...filters, search: '' }),
    })
    for (const s of filters.statuses) chips.push({
      key: `status-${s}`, label: `Status: ${s}`,
      onDelete: () => { const n = new Set(filters.statuses); n.delete(s); setFilters({ ...filters, statuses: n }) },
    })
    for (const id of filters.categoryIds) {
      const c = categories.find((x) => x.id === id)
      chips.push({
        key: `cat-${id}`, label: `Kategorie: ${c?.name ?? id}`,
        onDelete: () => { const n = new Set(filters.categoryIds); n.delete(id); setFilters({ ...filters, categoryIds: n }) },
      })
    }
    for (const id of filters.typeIds) {
      const t = categories.flatMap((c) => c.types).find((x) => x.id === id)
      chips.push({
        key: `type-${id}`, label: `Typ: ${t?.name ?? id}`,
        onDelete: () => { const n = new Set(filters.typeIds); n.delete(id); setFilters({ ...filters, typeIds: n }) },
      })
    }
    for (const c of filters.cities) chips.push({
      key: `city-${c}`, label: `Ort: ${c}`,
      onDelete: () => { const n = new Set(filters.cities); n.delete(c); setFilters({ ...filters, cities: n }) },
    })
    for (const id of filters.userIds) {
      const u = allUsers.find((x) => x.id === id)
      chips.push({
        key: `user-${id}`, label: `Benutzer: ${u ? `${u.firstName} ${u.lastName}` : id}`,
        onDelete: () => { const n = new Set(filters.userIds); n.delete(id); setFilters({ ...filters, userIds: n }) },
      })
    }
    for (const id of filters.groupIds) {
      const g = allGroups.find((x) => x.id === id)
      chips.push({
        key: `group-${id}`, label: `Gruppe: ${g?.name ?? id}`,
        onDelete: () => { const n = new Set(filters.groupIds); n.delete(id); setFilters({ ...filters, groupIds: n }) },
      })
    }
    if (filters.onlyOpenTodos) chips.push({
      key: 'todos', label: 'Nur mit offenen Todos',
      onDelete: () => setFilters({ ...filters, onlyOpenTodos: false }),
    })
    if (filters.onlyWithPhotos) chips.push({
      key: 'photos', label: 'Nur mit Fotos',
      onDelete: () => setFilters({ ...filters, onlyWithPhotos: false }),
    })
    return chips
  }

  const chips = renderActiveFilterChips()

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h5">
          {t('anlagen.title', { count: filtered.length })}
          {filtered.length !== anlagen.length && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              von {anlagen.length}
            </Typography>
          )}
        </Typography>
        <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
          <TextField
            size="small"
            placeholder={t('anlagenList.searchPlaceholder')}
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: filters.search ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setFilters({ ...filters, search: '' })}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
            sx={{ minWidth: 280 }}
          />
          <Button
            startIcon={<FilterListIcon />}
            variant="outlined"
            onClick={() => setDrawerOpen(true)}
          >
            Filter{chips.length > 0 ? ` (${chips.length})` : ''}
          </Button>
          <Select
            size="small"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="name">{t('anlagenList.sortName')}</MenuItem>
            <MenuItem value="projectNumber">{t('anlagenList.sortProjectNumber')}</MenuItem>
            <MenuItem value="city">Ort</MenuItem>
            <MenuItem value="updatedAt">{t('anlagenList.sortUpdatedAt')}</MenuItem>
          </Select>
          <Button
            startIcon={<ViewColumnIcon />}
            variant="outlined"
            onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
          >
            Spalten
          </Button>
          <Menu
            anchorEl={columnsMenuAnchor}
            open={Boolean(columnsMenuAnchor)}
            onClose={() => setColumnsMenuAnchor(null)}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="caption" color="text.secondary">{t('anlagenList.visibleColumns')}</Typography>
            </Box>
            <Divider />
            {COLUMNS.map((col) => (
              <MenuItem
                key={col.key}
                dense
                onClick={() => { if (!col.alwaysOn) toggleColumn(col.key) }}
                disabled={col.alwaysOn}
                sx={{ py: 0.25 }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={col.alwaysOn || visibleColumns.has(col.key)}
                      disabled={col.alwaysOn}
                    />
                  }
                  label={col.label}
                  sx={{ width: '100%', m: 0, pointerEvents: 'none' }}
                />
              </MenuItem>
            ))}
            <Divider />
            <Box sx={{ p: 1, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Button
                size="small"
                onClick={() => setVisibleColumns(new Set(COLUMNS.filter((c) => c.defaultOn).map((c) => c.key)))}
              >
                Standard
              </Button>
              <Button
                size="small"
                onClick={() => setVisibleColumns(new Set(COLUMNS.map((c) => c.key)))}
              >
                Alle
              </Button>
            </Box>
          </Menu>
          <Button variant="outlined" startIcon={<MapIcon />} onClick={() => navigate('/anlagen/map')}>Karte</Button>
          {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizardOpen(true)}>{t('anlagen.add')}</Button>}
        </Box>
      </Box>

      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sx={{
          '& .MuiDrawer-paper': {
            width: 280,
            maxWidth: '100vw',
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'rgba(255,255,255,0.12)',
            bgcolor: 'primary.dark',
            color: 'rgba(255,255,255,0.85)',
            backgroundImage: 'none',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        <Box sx={{ p: 2, pt: 3, textAlign: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600, color: 'white', display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterListIcon fontSize="small" />
              Filter
            </Typography>
            <IconButton onClick={() => setDrawerOpen(false)} size="small" sx={{ color: 'rgba(255,255,255,0.7)' }}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', display: 'block', mt: 0.5, textAlign: 'left' }}>
            Anlagen eingrenzen
          </Typography>
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)' }} />

        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            px: 2,
            py: 1.5,
            // Dark-Mode Overrides für das Filter-Panel innerhalb des Drawers
            '& .MuiAccordion-root': {
              bgcolor: 'transparent',
              color: 'inherit',
              borderColor: 'rgba(255,255,255,0.12) !important',
            },
            '& .MuiAccordionSummary-root, & .MuiAccordionDetails-root': {
              color: 'inherit',
            },
            '& .MuiTypography-root': { color: 'inherit' },
            '& .MuiTypography-caption': { color: 'rgba(255,255,255,0.6)' },
            // Nur „neutrale" Icons (Accordion-Chevron, Clear-Button) einfärben.
            // Checkbox-SVGs explizit ausnehmen, damit Mui-checked seine Farbe behält.
            '& .MuiAccordionSummary-expandIconWrapper .MuiSvgIcon-root, & .MuiInputAdornment-root .MuiSvgIcon-root': {
              color: 'rgba(255,255,255,0.7)',
            },
            '& .MuiCheckbox-root': { color: 'rgba(255,255,255,0.6)' },
            '& .MuiCheckbox-root.Mui-checked, & .MuiCheckbox-root.Mui-checked .MuiSvgIcon-root': {
              color: 'primary.main',
            },
            // Ausgewählte Facet-Einträge (Checkbox + Label) orange hervorheben
            '& .MuiFormControlLabel-root:has(.Mui-checked) .MuiTypography-body2': {
              color: 'primary.main',
              fontWeight: 600,
            },
            // Aktiver Facet-Counter (z.B. "Status (2)") im Accordion-Header
            '& .MuiAccordionSummary-root .MuiTypography-caption': {
              color: 'primary.main',
            },
            '& .MuiOutlinedInput-root': {
              color: 'white',
              bgcolor: 'rgba(255,255,255,0.06)',
              '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
              '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.4)' },
              '&.Mui-focused fieldset': { borderColor: 'primary.main' },
            },
            '& .MuiInputBase-input::placeholder': { color: 'rgba(255,255,255,0.5)', opacity: 1 },
          }}
        >
          <AnlagenFilterPanel
            value={filters}
            onChange={setFilters}
            counts={facetCounts}
            categories={categories}
            allUsers={allUsers}
            allGroups={allGroups}
          />
        </Box>

        {chips.length > 0 && (
          <>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)' }} />
            <Box sx={{ p: 1.5 }}>
              <Button
                size="small"
                fullWidth
                variant="outlined"
                onClick={() => setFilters(EMPTY_FILTERS)}
                sx={{
                  color: 'white',
                  borderColor: 'rgba(255,255,255,0.3)',
                  '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.08)' },
                }}
              >
                Alle zurücksetzen ({chips.length})
              </Button>
            </Box>
          </>
        )}
      </Drawer>

      <Box>
        <Box sx={{ minWidth: 0 }}>
          {/* Aktive Filter Chips */}
          {chips.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
              {chips.map((c) => (
                <Chip key={c.key} size="small" label={c.label} onDelete={c.onDelete} />
              ))}
              {!isFiltersEmpty(filters) && (
                <Chip size="small" label={t('anlagenList.resetAll')} variant="outlined" color="primary"
                  onClick={() => setFilters(EMPTY_FILTERS)} />
              )}
            </Box>
          )}

          <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
            <Table>
              <TableHead>
                <TableRow>
                  {orderedColumns.map((col) => (
                    <TableCell key={col.key} sx={{ width: col.width }}>
                      {col.key === 'status' ? t('common.status') :
                       col.key === 'name' ? t('common.name') :
                       col.label}
                    </TableCell>
                  ))}
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={orderedColumns.length + 1} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        {anlagen.length === 0 ? t('anlagen.empty') : 'Keine Anlage entspricht den Filtern.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((anlage) => {
                  const status = statusByAnlage.get(anlage.id) ?? 'EMPTY'
                  const openTodos = anlage.todos
                    ? anlage.todos.filter((tt) => tt.status === 'OPEN').length
                    : (anlage._count?.todos ?? 0)
                  return (
                    <TableRow
                      key={anlage.id}
                      hover
                      onClick={() => navigate(`/anlagen/${anlage.id}`)}
                      sx={{ cursor: 'pointer' }}
                    >
                      {orderedColumns.map((col) => (
                        <TableCell key={col.key}>
                          {col.key === 'status' && <StatusChip status={status} />}
                          {col.key === 'projectNumber' && (anlage.projectNumber ?? '—')}
                          {col.key === 'name' && anlage.name}
                          {col.key === 'city' && (anlage.city ?? '—')}
                          {col.key === 'erzeuger' && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {(anlage.erzeuger ?? []).slice(0, 3).map((e) => (
                                <Chip key={e.id} size="small" label={e.type.name} variant="outlined" />
                              ))}
                              {(anlage.erzeuger ?? []).length > 3 && (
                                <Chip size="small" label={`+${(anlage.erzeuger ?? []).length - 3}`} variant="outlined" />
                              )}
                            </Box>
                          )}
                          {col.key === 'address' && (
                            [anlage.street, [anlage.zip, anlage.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'
                          )}
                          {col.key === 'country' && (anlage.country ?? '—')}
                          {col.key === 'contactName' && (anlage.contactName ?? '—')}
                          {col.key === 'contactEmail' && (anlage.contactEmail ?? '—')}
                          {col.key === 'contactPhone' && (anlage.contactPhone || anlage.contactMobile || '—')}
                          {col.key === 'deviceCount' && (anlage._count?.anlageDevices ?? anlage.anlageDevices.length)}
                          {col.key === 'assignedUsers' && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {(anlage.directUsers ?? []).slice(0, 3).map((du) => (
                                <Chip key={du.user.id} size="small" label={`${du.user.firstName} ${du.user.lastName}`} variant="outlined" />
                              ))}
                              {(anlage.directUsers ?? []).length > 3 && (
                                <Chip size="small" label={`+${(anlage.directUsers ?? []).length - 3}`} variant="outlined" />
                              )}
                              {(anlage.directUsers ?? []).length === 0 && '—'}
                            </Box>
                          )}
                          {col.key === 'assignedGroups' && (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                              {(anlage.groupAnlagen ?? []).map((g) => (
                                <Chip key={g.group.id} size="small" label={g.group.name} variant="outlined" color="info" />
                              ))}
                              {(anlage.groupAnlagen ?? []).length === 0 && '—'}
                            </Box>
                          )}
                          {col.key === 'openTodos' && (
                            openTodos > 0
                              ? <Chip size="small" color="warning" label={openTodos} />
                              : '—'
                          )}
                          {col.key === 'updatedAt' && new Date(anlage.updatedAt).toLocaleDateString('de-CH')}
                        </TableCell>
                      ))}
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        {canDelete && (
                          <Tooltip title={t('common.delete')}>
                            <IconButton onClick={() => setDeleteTarget(anlage)} size="small" color="error">
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Box>

      <AnlageCreateWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('anlagen.deleteTitle')}
        message={t('anlagen.deleteMessage', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => { if (deleteTarget) { await deleteMutation.mutateAsync(deleteTarget.id); setDeleteTarget(null) } }}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />
    </Box>
  )
}
