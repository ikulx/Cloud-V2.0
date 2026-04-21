import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { useErzeugerTypes } from '../../features/erzeuger-types/queries'

export interface ErzeugerEntry {
  typeId: string
  serialNumber: string
}

interface Props {
  value: ErzeugerEntry[]
  onChange: (v: ErzeugerEntry[]) => void
  serialRequired: boolean
  /** Soll Fehler-Zustand aktiv angezeigt werden (z.B. nach Klick auf Speichern). */
  showErrors?: boolean
  disabled?: boolean
}

/**
 * Editor für die Erzeuger einer Anlage. Dropdown für den Typ (aus dem
 * konfigurierbaren Katalog) + optionale Seriennummer. Wenn in den
 * Einstellungen "Seriennummer obligatorisch" aktiv ist, wird das Feld
 * rot markiert solange es leer ist.
 */
export function ErzeugerPicker({ value, onChange, serialRequired, showErrors, disabled }: Props) {
  const { data: types = [] } = useErzeugerTypes()
  const activeTypes = types.filter((t) => t.isActive)

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
    // Default: erster aktiver Typ, leere Seriennummer
    const firstType = activeTypes[0]
    if (!firstType) return
    onChange([...value, { typeId: firstType.id, serialNumber: '' }])
  }

  const hasNoTypes = activeTypes.length === 0

  return (
    <Box>
      {value.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Noch kein Erzeuger hinzugefügt.
        </Typography>
      )}

      {value.map((row, idx) => {
        // Wenn der gewählte Typ inzwischen deaktiviert wurde, trotzdem anzeigen
        // (damit bestehende Einträge sichtbar bleiben).
        const includeInactive = types.find((t) => t.id === row.typeId && !t.isActive)
        const options = includeInactive ? [...activeTypes, includeInactive] : activeTypes
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
              sx={{ minWidth: 180 }}
            >
              {options.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}{!t.isActive ? ' (inaktiv)' : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={'Seriennummer' + (serialRequired ? ' *' : '')}
              value={row.serialNumber}
              onChange={(e) => updateRow(idx, { serialNumber: e.target.value })}
              error={serialInvalid}
              helperText={serialInvalid ? 'Pflichtfeld' : ''}
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
        disabled={disabled || hasNoTypes}
      >
        Erzeuger hinzufügen
      </Button>
      {hasNoTypes && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Noch keine aktiven Erzeuger-Typen im Katalog. In den Einstellungen → Erzeuger anlegen.
        </Typography>
      )}
    </Box>
  )
}
