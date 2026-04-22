import { useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Chip from '@mui/material/Chip'
import SaveIcon from '@mui/icons-material/Save'
import LockIcon from '@mui/icons-material/Lock'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import EventIcon from '@mui/icons-material/Event'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import {
  useHolidayRules,
  useUpdateHolidayRule,
  useHolidayDates,
  useCreateHolidayDate,
  useDeleteHolidayDate,
  type HolidayRule,
} from '../../features/alarms/queries'
import {
  useInternalAlarmTemplates,
  useUpdateInternalAlarmTemplate,
  type InternalAlarmTemplate,
  type AlarmPriority,
  type RecipientSchedule,
} from '../../features/alarms/queries'
import { ScheduleEditor } from '../anlagen/ScheduleEditor'
import { PiketManagerAdmin } from './PiketManagerAdmin'

type Draft = {
  email: string
  scheduleMode: 'always' | 'weekly'
  schedule: RecipientSchedule
  priorities: AlarmPriority[]
  delayMinutes: number
  sendOnHoliday: boolean
  deliveryChannel: 'EMAIL' | 'PIKET_MANAGER'
}

const PRIORITY_OPTIONS: { value: AlarmPriority; label: string; color: 'error' | 'warning' | 'info' }[] = [
  { value: 'PRIO1', label: 'Prio 1', color: 'error' },
  { value: 'PRIO2', label: 'Prio 2', color: 'error' },
  { value: 'PRIO3', label: 'Prio 3', color: 'warning' },
  { value: 'WARNING', label: 'Warnung', color: 'warning' },
  { value: 'INFO', label: 'Info', color: 'info' },
]

function toDraft(t: InternalAlarmTemplate): Draft {
  const s = t.schedule
  return {
    email: t.email ?? '',
    scheduleMode: s?.mode === 'weekly' ? 'weekly' : 'always',
    schedule: s ?? { mode: 'always' },
    priorities: t.priorities ?? [],
    delayMinutes: t.delayMinutes ?? 0,
    sendOnHoliday: !!t.sendOnHoliday,
    deliveryChannel: (t.deliveryChannel ?? 'EMAIL'),
  }
}

function draftChanged(d: Draft, t: InternalAlarmTemplate): boolean {
  if (d.email.trim() !== (t.email ?? '')) return true
  const tMode = t.schedule?.mode === 'weekly' ? 'weekly' : 'always'
  if (d.scheduleMode !== tMode) return true
  if (d.scheduleMode === 'weekly' && JSON.stringify(d.schedule) !== JSON.stringify(t.schedule)) return true
  if ((d.priorities ?? []).slice().sort().join(',') !== (t.priorities ?? []).slice().sort().join(',')) return true
  if ((d.delayMinutes ?? 0) !== (t.delayMinutes ?? 0)) return true
  if (!!d.sendOnHoliday !== !!t.sendOnHoliday) return true
  if ((d.deliveryChannel ?? 'EMAIL') !== (t.deliveryChannel ?? 'EMAIL')) return true
  return false
}

export function InternalAlarmTemplatesSettings() {
  const { data: templates = [], isLoading } = useInternalAlarmTemplates()
  const update = useUpdateInternalAlarmTemplate()

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [savedId, setSavedId] = useState<string | null>(null)

  const draftFor = (t: InternalAlarmTemplate): Draft => drafts[t.id] ?? toDraft(t)

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] ?? toDraft(templates.find((t) => t.id === id)!)), ...patch } }))

  const save = async (t: InternalAlarmTemplate) => {
    const d = draftFor(t)
    const payload = {
      id: t.id,
      email: d.email.trim() ? d.email.trim() : null,
      schedule: d.scheduleMode === 'always' ? ({ mode: 'always' } as RecipientSchedule) : d.schedule,
      priorities: d.priorities,
      delayMinutes: d.delayMinutes,
      sendOnHoliday: d.sendOnHoliday,
      deliveryChannel: d.deliveryChannel,
    }
    await update.mutateAsync(payload)
    setDrafts((x) => { const n = { ...x }; delete n[t.id]; return n })
    setSavedId(t.id)
    setTimeout(() => setSavedId(null), 2000)
  }

  const systemTemplates = templates.filter((t) => t.isSystem)

  return (
    <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 900 }}>
      <Typography variant="h6">Globale interne Empfänger</Typography>
      <Typography variant="body2" color="text.secondary">
        Diese Empfänger (Piketdienst, Ygnis PM) sind <strong>automatisch in
        jeder Anlage</strong> hinterlegt und können dort nur aktiviert oder
        deaktiviert werden. Adresse, Zeitplan, Prioritäten und Verzögerung
        werden hier zentral eingestellt und gelten für alle Anlagen.
      </Typography>

      {isLoading && (
        <Typography variant="body2" color="text.secondary">Lädt …</Typography>
      )}

      {systemTemplates.map((t) => {
        const d = draftFor(t)
        const dirty = drafts[t.id] !== undefined && draftChanged(drafts[t.id], t)
        return (
          <Card key={t.id}>
            <CardContent sx={{ pt: 3 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <LockIcon fontSize="small" color="action" />
                <Typography variant="subtitle1" fontWeight={600}>{t.label}</Typography>
                <Chip size="small" label="Intern" />
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<SaveIcon fontSize="small" />}
                  disabled={!dirty || update.isPending}
                  onClick={() => void save(t)}
                >
                  {savedId === t.id ? '✓ gespeichert' : 'Speichern'}
                </Button>
              </Stack>

              {t.key === 'piketdienst' && (
                <FormControl size="small" sx={{ mb: 2, minWidth: 280 }}>
                  <InputLabel id={`ch-${t.id}`}>Versand</InputLabel>
                  <Select
                    labelId={`ch-${t.id}`}
                    label="Versand"
                    value={d.deliveryChannel}
                    onChange={(e) => setDraft(t.id, { deliveryChannel: e.target.value as 'EMAIL' | 'PIKET_MANAGER' })}
                  >
                    <MenuItem value="EMAIL">E-Mail (klassisch)</MenuItem>
                    <MenuItem value="PIKET_MANAGER">Piket-Manager (Bereich + SMS + Eskalation)</MenuItem>
                  </Select>
                </FormControl>
              )}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
                <TextField
                  size="small"
                  fullWidth
                  label="E-Mail-Adresse"
                  type="email"
                  placeholder="adresse@example.com"
                  value={d.email}
                  disabled={t.key === 'piketdienst' && d.deliveryChannel === 'PIKET_MANAGER'}
                  onChange={(e) => setDraft(t.id, { email: e.target.value })}
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                />
                <TextField
                  size="small"
                  label="Verzögerung (Minuten)"
                  type="number"
                  sx={{ width: 200 }}
                  value={d.delayMinutes}
                  onChange={(e) => setDraft(t.id, { delayMinutes: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  inputProps={{ min: 0, max: 1440 }}
                />
              </Stack>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  Prioritäten (leer = alle)
                </Typography>
                <FormControl size="small" sx={{ minWidth: 240 }}>
                  <InputLabel id={`prios-${t.id}`}>Prioritäten</InputLabel>
                  <Select
                    labelId={`prios-${t.id}`}
                    multiple
                    label="Prioritäten"
                    value={d.priorities}
                    onChange={(e) => setDraft(t.id, {
                      priorities: (typeof e.target.value === 'string'
                        ? e.target.value.split(',')
                        : e.target.value) as AlarmPriority[],
                    })}
                    renderValue={(selected) => (selected as string[]).length === 0
                      ? <em>Alle</em>
                      : (selected as string[]).join(', ')}
                  >
                    {PRIORITY_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Divider sx={{ my: 2 }} />

              <FormControlLabel
                control={
                  <Switch
                    checked={d.sendOnHoliday}
                    onChange={(e) => setDraft(t.id, { sendOnHoliday: e.target.checked })}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2">An Feiertagen senden (Zeitplan ignorieren)</Typography>
                    <Typography variant="caption" color="text.secondary">
                      An einem in der Feiertagsliste hinterlegten Tag wird unabhängig
                      vom Wochenzeitplan versendet.
                    </Typography>
                  </Box>
                }
                sx={{ mb: 2, alignItems: 'flex-start' }}
              />

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" sx={{ mb: 1 }}>Zeitplan</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={d.scheduleMode}
                onChange={(_, v) => v && setDraft(t.id, { scheduleMode: v })}
                sx={{ mb: 2 }}
              >
                <ToggleButton value="always">Immer</ToggleButton>
                <ToggleButton value="weekly">Wochenplan</ToggleButton>
              </ToggleButtonGroup>
              {d.scheduleMode === 'weekly' && (
                <ScheduleEditor
                  value={d.schedule.mode === 'weekly' ? d.schedule : { mode: 'weekly' }}
                  onChange={(s) => setDraft(t.id, { schedule: s })}
                />
              )}
            </CardContent>
          </Card>
        )
      })}

      <HolidaysAdmin />
      <PiketManagerAdmin />
    </Box>
  )
}

// ── Feiertags-Admin (Popup) ─────────────────────────────────────────────────

function HolidaysAdmin() {
  const [open, setOpen] = useState(false)
  const { data: rules = [] } = useHolidayRules()
  const { data: dates = [] } = useHolidayDates()
  const activeRuleCount = rules.filter((r) => r.isActive).length

  return (
    <>
      <Card>
        <CardContent sx={{ pt: 3 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <EventIcon fontSize="small" color="action" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>Feiertage &amp; Sondertage</Typography>
              <Typography variant="caption" color="text.secondary">
                {rules.length > 0
                  ? `${activeRuleCount} von ${rules.length} Regeln aktiv`
                  : 'Noch keine Regeln vorhanden'}
                {dates.length > 0 && ` · ${dates.length} Sondertag${dates.length === 1 ? '' : 'e'}`}
              </Typography>
            </Box>
            <Button variant="outlined" size="small" onClick={() => setOpen(true)}>
              Verwalten
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Feiertage &amp; Sondertage</DialogTitle>
        <DialogContent dividers>
          <Stack gap={3} sx={{ pt: 1 }}>
            <HolidayRulesCard />
            <HolidayDatesCard />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Schliessen</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function formatRuleDate(r: HolidayRule, year: number): string {
  if (r.type === 'FIXED' && r.fixedMonth && r.fixedDay) {
    return `${String(r.fixedDay).padStart(2, '0')}.${String(r.fixedMonth).padStart(2, '0')}.`
  }
  if (r.type === 'EASTER_OFFSET' && r.easterOffset != null) {
    // Kleine clientseitige Berechnung rein für Anzeige
    const a = year % 19
    const b = Math.floor(year / 100)
    const c = year % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    const easter = new Date(Date.UTC(year, month - 1, day))
    const dt = new Date(Date.UTC(easter.getUTCFullYear(), easter.getUTCMonth(), easter.getUTCDate() + r.easterOffset))
    return dt.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  return '—'
}

function HolidayRulesCard() {
  const { data: rules = [], isLoading } = useHolidayRules()
  const update = useUpdateHolidayRule()
  const year = new Date().getFullYear()

  return (
    <Card>
      <CardContent sx={{ pt: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <EventIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" fontWeight={600}>Feiertage (jahresunabhängig)</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Wähle aus, welche Feiertage als Auslöser für die Feiertag-Option bei
          Piketdienst/Ygnis PM gelten sollen. Gilt automatisch für jedes Jahr.
          Standard: Kanton Luzern.
        </Typography>

        {isLoading ? (
          <Typography variant="body2" color="text.secondary">Lädt …</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 90 }} align="center">Aktiv</TableCell>
                <TableCell>Feiertag</TableCell>
                <TableCell sx={{ width: 140 }}>Termin {year}</TableCell>
                <TableCell sx={{ width: 80 }}>Region</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={r.isActive}
                      disabled={update.isPending}
                      onChange={(e) => update.mutate({ id: r.id, isActive: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell>{r.label}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{formatRuleDate(r, year)}</TableCell>
                  <TableCell>{r.region ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function HolidayDatesCard() {
  const { data: dates = [], isLoading } = useHolidayDates()
  const create = useCreateHolidayDate()
  const del = useDeleteHolidayDate()

  const [newDate, setNewDate] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const add = async () => {
    if (!newDate || !newLabel.trim()) return
    await create.mutateAsync({ date: newDate, label: newLabel.trim() })
    setNewDate(''); setNewLabel('')
  }

  return (
    <Card>
      <CardContent sx={{ pt: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <EventIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" fontWeight={600}>Eigene Sondertage</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Konkrete Einzeldaten – z.B. Betriebsferien, Brückentage, interne Events.
          Gelten nur für dieses eine Datum.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
          <TextField
            size="small" type="date" label="Datum"
            InputLabelProps={{ shrink: true }}
            value={newDate} onChange={(e) => setNewDate(e.target.value)}
            sx={{ width: 180 }}
          />
          <TextField
            size="small" label="Bezeichnung" fullWidth
            value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder="z.B. Betriebsferien Sommer"
          />
          <Button
            size="small" variant="contained" startIcon={<AddIcon />}
            disabled={!newDate || !newLabel.trim() || create.isPending}
            onClick={() => void add()}
          >
            Anlegen
          </Button>
        </Stack>

        {isLoading ? (
          <Typography variant="body2" color="text.secondary">Lädt …</Typography>
        ) : dates.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Sondertage hinterlegt.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 160 }}>Datum</TableCell>
                <TableCell>Bezeichnung</TableCell>
                <TableCell sx={{ width: 60 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {dates.map((h) => {
                const d = new Date(h.date)
                const fmt = d.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
                return (
                  <TableRow key={h.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{fmt}</TableCell>
                    <TableCell>{h.label}</TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        disabled={del.isPending}
                        onClick={() => { if (window.confirm(`Eintrag "${h.label}" löschen?`)) void del.mutate(h.id) }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
