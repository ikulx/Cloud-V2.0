import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Accordion from '@mui/material/Accordion'
import AccordionSummary from '@mui/material/AccordionSummary'
import AccordionDetails from '@mui/material/AccordionDetails'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ClearIcon from '@mui/icons-material/Clear'
import type { Anlage } from '../../types/model'
import type { ErzeugerCategoryWithTypes } from '../../features/erzeuger-types/queries'

export interface AnlagenFilters {
  search: string
  statuses: Set<string>         // 'OK' | 'TODO' | 'ERROR' | 'OFFLINE' | 'EMPTY'
  categoryIds: Set<string>      // Top-Level-Kategorien (alle Typen darunter gelten)
  typeIds: Set<string>          // konkrete Erzeuger-Typen
  cities: Set<string>
  userIds: Set<string>          // direkt zugewiesen
  groupIds: Set<string>
  onlyOpenTodos: boolean
  onlyWithPhotos: boolean
}

export const EMPTY_FILTERS: AnlagenFilters = {
  search: '',
  statuses: new Set(),
  categoryIds: new Set(),
  typeIds: new Set(),
  cities: new Set(),
  userIds: new Set(),
  groupIds: new Set(),
  onlyOpenTodos: false,
  onlyWithPhotos: false,
}

export function isFiltersEmpty(f: AnlagenFilters): boolean {
  return !f.search &&
    f.statuses.size === 0 &&
    f.categoryIds.size === 0 &&
    f.typeIds.size === 0 &&
    f.cities.size === 0 &&
    f.userIds.size === 0 &&
    f.groupIds.size === 0 &&
    !f.onlyOpenTodos &&
    !f.onlyWithPhotos
}

/** Zählt Anlagen pro Facet-Wert (für Anzeige "Wärmepumpe (12)"). */
interface Counts {
  status: Map<string, number>
  category: Map<string, number>
  type: Map<string, number>
  city: Map<string, number>
  user: Map<string, number>
  group: Map<string, number>
}

export function useAnlagenFacets(
  anlagen: Anlage[],
  categories: ErzeugerCategoryWithTypes[],
  statusOf: (a: Anlage) => string,
): Counts {
  return useMemo(() => {
    const status = new Map<string, number>()
    const category = new Map<string, number>()
    const type = new Map<string, number>()
    const city = new Map<string, number>()
    const user = new Map<string, number>()
    const group = new Map<string, number>()
    const typeToCategory = new Map<string, string | null>()
    for (const cat of categories) for (const t of cat.types) typeToCategory.set(t.id, cat.id)
    // Lookup für Parent-Chain
    const catById = new Map<string, ErzeugerCategoryWithTypes>()
    for (const c of categories) catById.set(c.id, c)
    const ancestorsOf = (catId: string): string[] => {
      const out: string[] = []
      let cur: string | null | undefined = catId
      while (cur) { out.push(cur); cur = catById.get(cur)?.parentId ?? null }
      return out
    }

    for (const a of anlagen) {
      status.set(statusOf(a), (status.get(statusOf(a)) ?? 0) + 1)
      if (a.city?.trim()) city.set(a.city, (city.get(a.city) ?? 0) + 1)
      const seenCats = new Set<string>()
      for (const e of a.erzeuger ?? []) {
        type.set(e.typeId, (type.get(e.typeId) ?? 0) + 1)
        const c = typeToCategory.get(e.typeId)
        if (c) {
          // Anlage zählt für jede Ancestor-Kategorie 1× (auch Unterordner sind
          // selbst Treffer, ihre Eltern bekommen ebenfalls einen Treffer).
          for (const anc of ancestorsOf(c)) {
            if (!seenCats.has(anc)) {
              category.set(anc, (category.get(anc) ?? 0) + 1)
              seenCats.add(anc)
            }
          }
        }
      }
      for (const du of a.directUsers ?? []) {
        user.set(du.user.id, (user.get(du.user.id) ?? 0) + 1)
      }
      for (const gp of a.groupAnlagen ?? []) {
        group.set(gp.group.id, (group.get(gp.group.id) ?? 0) + 1)
      }
    }
    return { status, category, type, city, user, group }
  }, [anlagen, categories, statusOf])
}

const STATUS_LABELS: Record<string, string> = {
  OK: 'OK',
  ERROR: 'Störung',
  OFFLINE: 'Offline',
  SUPPRESSED: 'Alarme unterdrückt',
  EMPTY: 'Leer',
}

interface Props {
  value: AnlagenFilters
  onChange: (v: AnlagenFilters) => void
  counts: Counts
  categories: ErzeugerCategoryWithTypes[]
  allUsers: { id: string; firstName: string; lastName: string }[]
  allGroups: { id: string; name: string }[]
}

export function AnlagenFilterPanel({ value, onChange, counts, categories, allUsers, allGroups }: Props) {
  const toggleIn = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  }

  const topCategories = useMemo(() => {
    return categories
      .filter((c) => c.parentId === null && c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [categories])

  // Flache, vor-sortierte Liste aller aktiven Kategorien inkl. Tiefe (DFS).
  const categoryTree = useMemo(() => {
    const byParent = new Map<string | null, ErzeugerCategoryWithTypes[]>()
    for (const c of categories) {
      if (!c.isActive) continue
      const k = c.parentId ?? null
      const arr = byParent.get(k) ?? []
      arr.push(c)
      byParent.set(k, arr)
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    const out: { cat: ErzeugerCategoryWithTypes; depth: number }[] = []
    const visit = (parentId: string | null, depth: number) => {
      for (const c of byParent.get(parentId) ?? []) {
        out.push({ cat: c, depth })
        visit(c.id, depth + 1)
      }
    }
    visit(null, 0)
    return out
  }, [categories])

  const allTypesForCategory = (rootId: string): string[] => {
    // Typen an dieser Kategorie + alle in deren Unterordnern
    const out: string[] = []
    const visit = (id: string) => {
      for (const c of categories) {
        if (c.id === id) for (const t of c.types) out.push(t.id)
      }
      for (const c of categories) if (c.parentId === id) visit(c.id)
    }
    visit(rootId)
    return out
  }

  const cityOptions = useMemo(() => {
    return Array.from(counts.city.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [counts.city])

  const userOptions = useMemo(() => {
    return allUsers
      .map((u) => ({ ...u, count: counts.user.get(u.id) ?? 0 }))
      .filter((u) => u.count > 0)
      .sort((a, b) => b.count - a.count || `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`))
  }, [allUsers, counts.user])

  const groupOptions = useMemo(() => {
    return allGroups
      .map((g) => ({ ...g, count: counts.group.get(g.id) ?? 0 }))
      .filter((g) => g.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [allGroups, counts.group])

  const [cityQuery, setCityQuery] = useState('')

  return (
    <Box>
      <FacetSection label="Status" count={value.statuses.size}>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <FilterCheckbox
            key={key}
            checked={value.statuses.has(key)}
            label={label}
            count={counts.status.get(key) ?? 0}
            onToggle={() => onChange({ ...value, statuses: toggleIn(value.statuses, key) })}
          />
        ))}
      </FacetSection>

      <FacetSection label="Erzeuger-Kategorie" count={value.categoryIds.size}>
        {categoryTree.length === 0 && <Typography variant="caption" color="text.secondary">Keine Kategorien</Typography>}
        {categoryTree
          .filter(({ cat }) => (counts.category.get(cat.id) ?? 0) > 0 || value.categoryIds.has(cat.id))
          .map(({ cat, depth }) => (
            <FilterCheckbox
              key={cat.id}
              checked={value.categoryIds.has(cat.id)}
              label={cat.name}
              count={counts.category.get(cat.id) ?? 0}
              indent={depth}
              onToggle={() => onChange({ ...value, categoryIds: toggleIn(value.categoryIds, cat.id) })}
            />
          ))}
      </FacetSection>

      <FacetSection label="Erzeuger-Typ" count={value.typeIds.size}>
        {/* Typen gruppiert nach Top-Kategorie, nur solche mit Anlagen-Treffer */}
        {topCategories.map((cat) => {
          const typeIds = allTypesForCategory(cat.id)
          const visible = typeIds
            .map((tid) => {
              const t = categories.flatMap((c) => c.types).find((x) => x.id === tid)
              return t ? { t, count: counts.type.get(tid) ?? 0 } : null
            })
            .filter((x): x is { t: ErzeugerCategoryWithTypes['types'][number]; count: number } => !!x && x.count > 0)
          if (visible.length === 0) return null
          return (
            <Box key={cat.id} sx={{ mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 0.5, pt: 0.5 }}>
                {cat.name}
              </Typography>
              {visible.map(({ t, count }) => (
                <FilterCheckbox
                  key={t.id}
                  checked={value.typeIds.has(t.id)}
                  label={t.name}
                  count={count}
                  onToggle={() => onChange({ ...value, typeIds: toggleIn(value.typeIds, t.id) })}
                />
              ))}
            </Box>
          )
        })}
      </FacetSection>

      {cityOptions.length > 0 && (
        <FacetSection label="Ort" count={value.cities.size}>
          {cityOptions.length > 8 && (
            <TextField
              fullWidth size="small" placeholder="Ort suchen"
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              sx={{ mb: 0.5 }}
            />
          )}
          <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
            {cityOptions
              .filter(([c]) => c.toLowerCase().includes(cityQuery.toLowerCase()))
              .map(([c, cnt]) => (
                <FilterCheckbox
                  key={c}
                  checked={value.cities.has(c)}
                  label={c}
                  count={cnt}
                  onToggle={() => onChange({ ...value, cities: toggleIn(value.cities, c) })}
                />
              ))}
          </Box>
        </FacetSection>
      )}

      {userOptions.length > 0 && (
        <FacetSection label="Zugewiesen an" count={value.userIds.size}>
          {userOptions.map((u) => (
            <FilterCheckbox
              key={u.id}
              checked={value.userIds.has(u.id)}
              label={`${u.firstName} ${u.lastName}`}
              count={u.count}
              onToggle={() => onChange({ ...value, userIds: toggleIn(value.userIds, u.id) })}
            />
          ))}
        </FacetSection>
      )}

      {groupOptions.length > 0 && (
        <FacetSection label="Gruppe" count={value.groupIds.size}>
          {groupOptions.map((g) => (
            <FilterCheckbox
              key={g.id}
              checked={value.groupIds.has(g.id)}
              label={g.name}
              count={g.count}
              onToggle={() => onChange({ ...value, groupIds: toggleIn(value.groupIds, g.id) })}
            />
          ))}
        </FacetSection>
      )}

      <FacetSection label="Sonstiges" count={(value.onlyOpenTodos ? 1 : 0) + (value.onlyWithPhotos ? 1 : 0)}>
        <FilterCheckbox
          checked={value.onlyOpenTodos}
          label="Nur mit offenen Todos"
          onToggle={() => onChange({ ...value, onlyOpenTodos: !value.onlyOpenTodos })}
        />
        <FilterCheckbox
          checked={value.onlyWithPhotos}
          label="Nur mit Fotos"
          onToggle={() => onChange({ ...value, onlyWithPhotos: !value.onlyWithPhotos })}
        />
      </FacetSection>

      {!isFiltersEmpty(value) && (
        <Button
          fullWidth
          variant="text"
          color="inherit"
          startIcon={<ClearIcon fontSize="small" />}
          onClick={() => onChange(EMPTY_FILTERS)}
          sx={{ mt: 1, justifyContent: 'flex-start' }}
        >
          Alle Filter zurücksetzen
        </Button>
      )}
    </Box>
  )
}

function FacetSection({
  label, count, defaultOpen = false, children,
}: {
  label: string
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  // Wenn dieser Facet schon aktive Filter hat, beim Mount automatisch öffnen –
  // sonst standardmäßig zu.
  const [open, setOpen] = useState(defaultOpen || count > 0)
  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={open}
      onChange={() => setOpen(!open)}
      sx={{ '&:before': { display: 'none' }, borderBottom: '1px solid', borderColor: 'divider' }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 0, minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{label}</Typography>
        {count > 0 && <Typography variant="caption" color="primary" sx={{ mr: 1, fontWeight: 600 }}>{count}</Typography>}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0, pb: 1 }}>
        <Collapse in={open}>
          <Box>{children}</Box>
        </Collapse>
      </AccordionDetails>
    </Accordion>
  )
}

function FilterCheckbox({
  checked, label, count, onToggle, indent = 0,
}: {
  checked: boolean
  label: string
  count?: number
  onToggle: () => void
  indent?: number
}) {
  return (
    <FormControlLabel
      control={<Checkbox size="small" checked={checked} onChange={onToggle} />}
      label={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
          <Typography variant="body2" sx={{ flex: 1 }}>{label}</Typography>
          {count !== undefined && (
            <Typography variant="caption" color="text.secondary">({count})</Typography>
          )}
        </Box>
      }
      sx={{ width: '100%', m: 0, py: 0.25, pl: indent * 2 }}
    />
  )
}
