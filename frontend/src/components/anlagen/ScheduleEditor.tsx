import { useCallback } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/AddCircleOutline'
import RemoveIcon from '@mui/icons-material/RemoveCircleOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RadioGroup from '@mui/material/RadioGroup'
import Radio from '@mui/material/Radio'
import FormControlLabel from '@mui/material/FormControlLabel'
import { useState } from 'react'
import type {
  RecipientSchedule, RecipientScheduleDay, RecipientScheduleWindow,
} from '../../features/alarms/queries'

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WEEKDAYS = [0, 1, 2, 3, 4]
const WEEKEND = [5, 6]

// ── Presets ─────────────────────────────────────────────────────────────────
interface Preset { id: string; label: string; build: () => RecipientSchedule }

const PRESETS: Preset[] = [
  {
    id: '247',
    label: '24 / 7',
    build: () => ({
      mode: 'weekly',
      days: Array.from({ length: 7 }, () => ({
        enabled: true, windows: [{ start: '00:00', end: '23:59' }],
      })),
    }),
  },
  {
    id: 'office',
    label: 'Bürozeit Mo–Fr 08–17',
    build: () => ({
      mode: 'weekly',
      days: Array.from({ length: 7 }, (_, i) => ({
        enabled: i < 5,
        windows: i < 5 ? [{ start: '08:00', end: '17:00' }] : [],
      })),
    }),
  },
  {
    id: 'shift',
    label: 'Werktag 06–22',
    build: () => ({
      mode: 'weekly',
      days: Array.from({ length: 7 }, (_, i) => ({
        enabled: i < 5,
        windows: i < 5 ? [{ start: '06:00', end: '22:00' }] : [],
      })),
    }),
  },
  {
    id: 'weekend',
    label: 'Wochenende',
    build: () => ({
      mode: 'weekly',
      days: Array.from({ length: 7 }, (_, i) => ({
        enabled: i >= 5,
        windows: i >= 5 ? [{ start: '00:00', end: '23:59' }] : [],
      })),
    }),
  },
  {
    id: 'night',
    label: 'Bereitschaft Nacht 22–06',
    build: () => ({
      mode: 'weekly',
      days: Array.from({ length: 7 }, () => ({
        enabled: true,
        // Endzeit < Startzeit = über Mitternacht
        windows: [{ start: '22:00', end: '06:00' }],
      })),
    }),
  },
]

function emptyWeek(): RecipientScheduleDay[] {
  return Array.from({ length: 7 }, () => ({ enabled: false, windows: [] as RecipientScheduleWindow[] }))
}

interface Props {
  value: RecipientSchedule
  onChange: (v: RecipientSchedule) => void
}

export function ScheduleEditor({ value, onChange }: Props) {
  const days = value.days ?? emptyWeek()

  const setDay = useCallback((i: number, patch: Partial<RecipientScheduleDay>) => {
    const next = days.slice()
    next[i] = { ...next[i], ...patch }
    onChange({ mode: 'weekly', days: next })
  }, [days, onChange])

  const addWindow = (i: number) => {
    const cur = days[i].windows ?? []
    // Default-Fenster: an vorheriges anschliessen (keep-alive UX)
    const last = cur[cur.length - 1]
    const defaultStart = last ? last.end : '08:00'
    const defaultEnd = last ? '23:59' : '17:00'
    setDay(i, {
      enabled: true,
      windows: [...cur, { start: defaultStart, end: defaultEnd }],
    })
  }

  const removeWindow = (i: number, w: number) => {
    const cur = days[i].windows.slice()
    cur.splice(w, 1)
    setDay(i, { windows: cur })
  }

  const updateWindow = (i: number, w: number, patch: Partial<RecipientScheduleWindow>) => {
    const cur = days[i].windows.slice()
    cur[w] = { ...cur[w], ...patch }
    setDay(i, { windows: cur })
  }

  return (
    <Box>
      <RadioGroup
        row
        value={value.mode}
        onChange={(e) => {
          const mode = e.target.value as 'always' | 'weekly'
          if (mode === 'always') onChange({ mode: 'always' })
          else onChange({ mode: 'weekly', days: days.some((d) => d.enabled) ? days : PRESETS[1].build().days })
        }}
      >
        <FormControlLabel value="always" control={<Radio size="small" />} label="Immer aktiv" />
        <FormControlLabel value="weekly" control={<Radio size="small" />} label="Wochenplan" />
      </RadioGroup>

      {value.mode === 'weekly' && (
        <>
          {/* Presets */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mb: -0.5 }}>
              Vorlage anwenden:
            </Typography>
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                size="small"
                variant="outlined"
                onClick={() => onChange(p.build())}
                sx={{ textTransform: 'none' }}
              >
                {p.label}
              </Button>
            ))}
            <Button
              size="small"
              variant="text"
              color="inherit"
              onClick={() => onChange({ mode: 'weekly', days: emptyWeek() })}
              sx={{ textTransform: 'none' }}
            >
              Leer
            </Button>
          </Box>

          {/* Tage-Grid */}
          <Stack gap={0.75}>
            {days.map((d, i) => (
              <DayRow
                key={i}
                dayIndex={i}
                day={d}
                onToggle={(enabled) => setDay(i, { enabled, windows: enabled && d.windows.length === 0 ? [{ start: '08:00', end: '17:00' }] : d.windows })}
                onAddWindow={() => addWindow(i)}
                onRemoveWindow={(w) => removeWindow(i, w)}
                onUpdateWindow={(w, patch) => updateWindow(i, w, patch)}
                onCopyTo={(targetIndices) => {
                  const next = days.slice()
                  for (const t of targetIndices) {
                    if (t === i) continue
                    next[t] = {
                      enabled: d.enabled,
                      windows: d.windows.map((w) => ({ ...w })),
                    }
                  }
                  onChange({ mode: 'weekly', days: next })
                }}
              />
            ))}
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Tipp: Endzeit vor Startzeit ergibt ein Fenster über Mitternacht (z.&nbsp;B. 22:00 → 06:00).
          </Typography>
        </>
      )}
    </Box>
  )
}

// ── Row pro Wochentag ───────────────────────────────────────────────────────

function DayRow({
  dayIndex, day, onToggle, onAddWindow, onRemoveWindow, onUpdateWindow, onCopyTo,
}: {
  dayIndex: number
  day: RecipientScheduleDay
  onToggle: (enabled: boolean) => void
  onAddWindow: () => void
  onRemoveWindow: (w: number) => void
  onUpdateWindow: (w: number, patch: Partial<RecipientScheduleWindow>) => void
  onCopyTo: (targetIndices: number[]) => void
}) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '48px 56px 1fr auto',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        opacity: day.enabled ? 1 : 0.55,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{DAY_LABELS[dayIndex]}</Typography>

      <Switch
        size="small"
        checked={day.enabled}
        onChange={(e) => onToggle(e.target.checked)}
      />

      {/* Zeitfenster-Liste */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        {day.windows.length === 0 && day.enabled && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Kein Fenster – „+" hinzufügen
          </Typography>
        )}
        {!day.enabled && (
          <Typography variant="caption" color="text.secondary">Aus</Typography>
        )}
        {day.windows.map((w, wi) => (
          <Box key={wi} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
              type="time"
              size="small"
              value={w.start}
              disabled={!day.enabled}
              onChange={(e) => onUpdateWindow(wi, { start: e.target.value })}
              sx={{ width: 108 }}
              inputProps={{ step: 300 }}
            />
            <Typography variant="body2" sx={{ mx: 0.5 }}>–</Typography>
            <TextField
              type="time"
              size="small"
              value={w.end}
              disabled={!day.enabled}
              onChange={(e) => onUpdateWindow(wi, { end: e.target.value })}
              sx={{ width: 108 }}
              inputProps={{ step: 300 }}
            />
            <Tooltip title="Fenster entfernen">
              <IconButton size="small" disabled={!day.enabled} onClick={() => onRemoveWindow(wi)}>
                <RemoveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
        {day.enabled && day.windows.length < 4 && (
          <Tooltip title="Weiteres Fenster hinzufügen">
            <IconButton size="small" onClick={onAddWindow}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Copy-Menu */}
      <Tooltip title="Auf andere Tage kopieren">
        <span>
          <IconButton
            size="small"
            disabled={!day.enabled && day.windows.length === 0}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => { onCopyTo(WEEKDAYS); setMenuAnchor(null) }}
          disabled={WEEKDAYS.includes(dayIndex) && WEEKDAYS.every((d) => d === dayIndex)}
        >
          Auf Mo–Fr kopieren
        </MenuItem>
        <MenuItem onClick={() => { onCopyTo(WEEKEND); setMenuAnchor(null) }}>
          Auf Sa+So kopieren
        </MenuItem>
        <MenuItem onClick={() => { onCopyTo([0, 1, 2, 3, 4, 5, 6]); setMenuAnchor(null) }}>
          Auf alle Tage kopieren
        </MenuItem>
      </Menu>
    </Box>
  )
}
