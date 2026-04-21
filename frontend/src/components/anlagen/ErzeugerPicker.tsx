import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import ListSubheader from '@mui/material/ListSubheader'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { useErzeugerCategories } from '../../features/erzeuger-types/queries'

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
 * Editor für die Erzeuger einer Anlage. Zwei-stufiger Katalog:
 * Kategorie (als ListSubheader im Dropdown) → Typ. Die Seriennummer-
 * Pflicht kommt pro Typ aus dem Katalog (serialRequired).
 */
export function ErzeugerPicker({ value, onChange, showErrors, disabled }: Props) {
  const { data: categories = [] } = useErzeugerCategories()
  const activeCategories = categories.filter((c) => c.isActive)

  // Schnellzugriff: typeId → {type, category} (für SN-Required-Check)
  const typeMap = new Map<string, { type: (typeof activeCategories)[number]['types'][number]; category: typeof activeCategories[number] }>()
  for (const cat of categories) {
    for (const t of cat.types) typeMap.set(t.id, { type: t, category: cat })
  }

  const hasNoOptions = activeCategories.every((c) => c.types.filter((t) => t.isActive).length === 0)

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
    // Default: erster Typ aus erster aktiver Kategorie mit aktiven Typen
    for (const cat of activeCategories) {
      const firstType = cat.types.find((t) => t.isActive)
      if (firstType) {
        onChange([...value, { typeId: firstType.id, serialNumber: '' }])
        return
      }
    }
  }

  // Baut die Items für das Dropdown inkl. ListSubheader pro Kategorie.
  const buildMenuItems = (includeTypeId: string | null) => {
    const items: React.ReactNode[] = []
    for (const cat of activeCategories) {
      const types = cat.types.filter((t) => t.isActive)
      // Falls der aktuell gewählte Typ in dieser (inaktiv gewordenen) Kategorie
      // liegt, trotzdem mit einblenden.
      if (includeTypeId) {
        const inactiveTypeInThisCat = cat.types.find((t) => t.id === includeTypeId && !t.isActive)
        if (inactiveTypeInThisCat && !types.includes(inactiveTypeInThisCat)) {
          types.push(inactiveTypeInThisCat)
        }
      }
      if (types.length === 0) continue
      items.push(
        <ListSubheader key={`c-${cat.id}`} sx={{ fontSize: 12, lineHeight: '28px' }}>
          {cat.name}
        </ListSubheader>,
      )
      for (const t of types) {
        items.push(
          <MenuItem key={t.id} value={t.id}>
            {t.name}{!t.isActive ? ' (inaktiv)' : ''}
          </MenuItem>,
        )
      }
    }
    // Fallback für verwaisten gewählten Typ (Kategorie gelöscht/inaktiv)
    if (includeTypeId) {
      const hasIt = activeCategories.some((c) => c.types.some((t) => t.id === includeTypeId))
      if (!hasIt) {
        // Über alle – auch inaktive – Kategorien suchen
        const all = categories.flatMap((c) => c.types.map((t) => ({ cat: c, t })))
        const found = all.find((x) => x.t.id === includeTypeId)
        if (found) {
          items.push(
            <ListSubheader key={`c-legacy-${found.cat.id}`} sx={{ fontSize: 12 }}>
              {found.cat.name} (inaktiv)
            </ListSubheader>,
          )
          items.push(
            <MenuItem key={found.t.id} value={found.t.id}>
              {found.t.name} (inaktiv)
            </MenuItem>,
          )
        }
      }
    }
    return items
  }

  return (
    <Box>
      {value.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Noch kein Erzeuger hinzugefügt.
        </Typography>
      )}

      {value.map((row, idx) => {
        const meta = typeMap.get(row.typeId)
        const serialRequired = meta?.type.serialRequired ?? true
        const serialInvalid = showErrors && serialRequired && !row.serialNumber.trim()

        return (
          <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
            <TextField
              select
              size="small"
              label="Typ"
              value={row.typeId}
              onChange={(e) => updateRow(idx, { typeId: e.target.value })}
              disabled={disabled}
              sx={{ minWidth: 240 }}
              SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 360 } } } }}
            >
              {buildMenuItems(row.typeId)}
            </TextField>
            <TextField
              size="small"
              label={'Seriennummer' + (serialRequired ? ' *' : '')}
              value={row.serialNumber}
              onChange={(e) => updateRow(idx, { serialNumber: e.target.value })}
              error={serialInvalid}
              helperText={serialInvalid ? 'Pflichtfeld für diesen Typ' : ''}
              disabled={disabled}
              fullWidth
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
    </Box>
  )
}
