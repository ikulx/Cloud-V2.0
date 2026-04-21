import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import InputLabel from '@mui/material/InputLabel'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Switch from '@mui/material/Switch'
import Stack from '@mui/material/Stack'
import Divider from '@mui/material/Divider'
import RadioGroup from '@mui/material/RadioGroup'
import Radio from '@mui/material/Radio'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EmailIcon from '@mui/icons-material/Email'
import SmsIcon from '@mui/icons-material/Sms'
import TelegramIcon from '@mui/icons-material/Telegram'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import ScheduleIcon from '@mui/icons-material/Schedule'
import {
  useAlarmRecipients, useCreateAlarmRecipient, useUpdateAlarmRecipient, useDeleteAlarmRecipient,
  useAlarmEvents,
  type AlarmRecipient, type AlarmPriority, type AlarmRecipientType, type AlarmEvent,
  type RecipientSchedule, type RecipientScheduleDay,
} from '../../features/alarms/queries'
import { useAnlage, useUpdateAnlage } from '../../features/anlagen/queries'
import CloudOffIcon from '@mui/icons-material/CloudOff'

const PRIORITIES: AlarmPriority[] = ['PRIO1', 'PRIO2', 'PRIO3', 'WARNING', 'INFO']
const PRIO_LABEL: Record<AlarmPriority, string> = {
  PRIO1: 'Prio 1', PRIO2: 'Prio 2', PRIO3: 'Prio 3', WARNING: 'Warnung', INFO: 'Info',
}
const PRIO_COLOR: Record<AlarmPriority, 'error' | 'warning' | 'info' | 'default'> = {
  PRIO1: 'error', PRIO2: 'error', PRIO3: 'warning', WARNING: 'warning', INFO: 'info',
}

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function defaultSchedule(): RecipientSchedule {
  return {
    mode: 'always',
    days: Array.from({ length: 7 }, () => ({ enabled: true, start: '00:00', end: '23:59' })),
  }
}

/** Menschlich lesbare Kurzform des Zeitplans, z.B. "Mo-Fr 06–22" */
function formatScheduleSummary(s: RecipientSchedule | null | undefined): string {
  if (!s || s.mode !== 'weekly' || !s.days) return 'immer'
  const active = s.days.map((d, i) => (d.enabled ? i : -1)).filter((i) => i >= 0)
  if (active.length === 0) return 'nie aktiv'
  // Kompakte Bereich-Erkennung: zusammenhängende Day-Indizes zusammenfassen
  const ranges: string[] = []
  let i = 0
  while (i < active.length) {
    let j = i
    while (j + 1 < active.length && active[j + 1] === active[j] + 1) j++
    ranges.push(i === j ? DAY_LABELS[active[i]] : `${DAY_LABELS[active[i]]}-${DAY_LABELS[active[j]]}`)
    i = j + 1
  }
  const first = s.days[active[0]]
  const sameTimes = active.every((d) => s.days![d].start === first.start && s.days![d].end === first.end)
  if (sameTimes) return `${ranges.join(', ')} ${first.start}–${first.end}`
  return `${ranges.join(', ')} (gemischt)`
}

function TypeIcon({ type }: { type: AlarmRecipientType }) {
  if (type === 'EMAIL') return <EmailIcon fontSize="small" />
  if (type === 'SMS') return <SmsIcon fontSize="small" />
  return <TelegramIcon fontSize="small" />
}

interface Props {
  anlageId: string
}

export function AnlageAlarmsTab({ anlageId }: Props) {
  const { data: anlage } = useAnlage(anlageId)
  const updateAnlage = useUpdateAnlage(anlageId)
  const { data: recipients = [], isLoading: rLoading } = useAlarmRecipients(anlageId)
  // Bewusst nur aktive Events – die Cloud zeigt nicht mehr die volle Historie.
  const { data: events = [], isLoading: eLoading } = useAlarmEvents({
    anlageId, status: 'ACTIVE', limit: 100,
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AlarmRecipient | null>(null)

  const offlineMonitoring = anlage?.offlineMonitoringEnabled ?? true
  const rateLimit = anlage?.alarmRateLimitMinutes ?? 60
  const [rateLimitInput, setRateLimitInput] = useState<string>(String(rateLimit))
  useEffect(() => { setRateLimitInput(String(rateLimit)) }, [rateLimit])

  const saveRateLimit = () => {
    const n = parseInt(rateLimitInput, 10)
    if (!Number.isFinite(n) || n < 0 || n > 10080) return
    if (n === rateLimit) return
    updateAnlage.mutate({ alarmRateLimitMinutes: n })
  }

  return (
    <Stack gap={3}>
      {/* ── Offline-Überwachung ───────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CloudOffIcon sx={{ color: offlineMonitoring ? 'primary.main' : 'text.disabled' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>Offline-Überwachung</Typography>
            <Typography variant="caption" color="text.secondary">
              Bei längerer Nichterreichbarkeit eines Geräts dieser Anlage wird die in den
              System­einstellungen konfigurierte Alarm­adresse per E-Mail informiert –
              und beim Wiederhochkommen ebenfalls. Die Schwelle (Standard: 3 h) wird global gesetzt.
            </Typography>
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={offlineMonitoring}
                disabled={!anlage || updateAnlage.isPending}
                onChange={(e) => updateAnlage.mutate({ offlineMonitoringEnabled: e.target.checked })}
              />
            }
            label={offlineMonitoring ? 'aktiv' : 'aus'}
            labelPlacement="start"
          />
        </Box>
      </Paper>

      {/* ── Rate-Limit ───────────────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ScheduleIcon color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>Versand-Limit</Typography>
            <Typography variant="caption" color="text.secondary">
              Minimaler Abstand zwischen ausgehenden Alarm-Meldungen dieser Anlage.
              Zusätzliche Ereignisse im Fenster werden weiterhin als Alarm erkannt
              und angezeigt, aber nicht erneut versendet.
            </Typography>
          </Box>
          <TextField
            type="number"
            label="Minuten"
            size="small"
            value={rateLimitInput}
            onChange={(e) => setRateLimitInput(e.target.value)}
            onBlur={saveRateLimit}
            onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
            inputProps={{ min: 0, max: 10080, step: 5 }}
            sx={{ width: 110 }}
          />
        </Box>
      </Paper>

      {/* ── Empfänger ───────────────────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6">Alarm-Empfänger</Typography>
            <Typography variant="caption" color="text.secondary">
              Wer wird bei einem Alarm dieser Anlage benachrichtigt? Empfänger ohne
              aktiven Zeitplan-Eintrag zum Alarm­zeitpunkt bekommen keine Meldung
              (auch keine nachträgliche).
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => { setEditing(null); setDialogOpen(true) }}
          >
            Empfänger hinzufügen
          </Button>
        </Box>

        {rLoading ? (
          <Typography variant="body2" color="text.secondary">Lädt …</Typography>
        ) : recipients.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Noch keine Empfänger. Fügen Sie mindestens einen hinzu, damit Alarme zugestellt werden.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Kanal</TableCell>
                  <TableCell>Ziel</TableCell>
                  <TableCell>Label</TableCell>
                  <TableCell>Prioritäten</TableCell>
                  <TableCell>Zeitplan</TableCell>
                  <TableCell align="center">Aktiv</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {recipients.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell><Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><TypeIcon type={r.type} />{r.type}</Box></TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>{r.target}</TableCell>
                    <TableCell>{r.label ?? '—'}</TableCell>
                    <TableCell>
                      {r.priorities.length === 0 ? (
                        <Chip size="small" label="Alle" variant="outlined" />
                      ) : (
                        <Box sx={{ display: 'flex', gap: 0.3, flexWrap: 'wrap' }}>
                          {r.priorities.map((p) => (
                            <Chip key={p} size="small" label={PRIO_LABEL[p]} color={PRIO_COLOR[p]} variant="outlined" />
                          ))}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 13 }}>{formatScheduleSummary(r.schedule)}</TableCell>
                    <TableCell align="center">
                      {r.isActive
                        ? <CheckCircleIcon fontSize="small" color="success" />
                        : <CancelIcon fontSize="small" color="disabled" />}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Bearbeiten">
                        <IconButton size="small" onClick={() => { setEditing(r); setDialogOpen(true) }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* ── Aktive Alarme ──────────────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2 }}>
        <Typography variant="h6">Aktive Alarme</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Aktuell ausstehende Alarme dieser Anlage. Alarme werden vom Gerät automatisch
          gelöscht, sobald die Auslösebedingung wegfällt – ein manuelles Quittieren auf
          der Cloud ist nicht nötig.
        </Typography>
        <Divider sx={{ mb: 2 }} />

        {eLoading ? (
          <Typography variant="body2" color="text.secondary">Lädt …</Typography>
        ) : events.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Keine aktiven Alarme – alles ruhig.
          </Typography>
        ) : (
          <ActiveAlarmList events={events} />
        )}
      </Paper>

      <RecipientDialog
        open={dialogOpen}
        anlageId={anlageId}
        editing={editing}
        onClose={() => setDialogOpen(false)}
      />
    </Stack>
  )
}

// ─── Event-Liste (ohne Acknowledge) ───────────────────────────────────────────

function ActiveAlarmList({ events }: { events: AlarmEvent[] }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Zeit</TableCell>
            <TableCell>Priorität</TableCell>
            <TableCell>Meldung</TableCell>
            <TableCell>Gerät</TableCell>
            <TableCell>Versand</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((e) => {
            const sentCount = e.deliveries.filter((d) => d.status === 'SENT').length
            const failedCount = e.deliveries.filter((d) => d.status === 'FAILED').length
            const skippedCount = e.deliveries.filter((d) => d.status === 'SKIPPED').length
            return (
              <TableRow key={e.id} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(e.activatedAt).toLocaleString('de-CH')}</TableCell>
                <TableCell><Chip size="small" label={PRIO_LABEL[e.priority]} color={PRIO_COLOR[e.priority]} /></TableCell>
                <TableCell>{e.message}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', fontSize: 13 }}>{e.device.name}</TableCell>
                <TableCell sx={{ fontSize: 12 }}>
                  {sentCount > 0 && <span style={{ color: '#4caf50' }}>✓ {sentCount}</span>}
                  {failedCount > 0 && <span style={{ color: '#f44336', marginLeft: 6 }}>✗ {failedCount}</span>}
                  {skippedCount > 0 && (
                    <Tooltip title="Nicht versendet – Rate-Limit oder ausserhalb des Zeitplans">
                      <span style={{ color: '#9e9e9e', marginLeft: 6, cursor: 'help' }}>– {skippedCount}</span>
                    </Tooltip>
                  )}
                  {e.deliveries.length === 0 && <span style={{ color: '#9e9e9e' }}>—</span>}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

// ─── Empfänger-Dialog ─────────────────────────────────────────────────────────

function RecipientDialog({
  open, anlageId, editing, onClose,
}: {
  open: boolean
  anlageId: string
  editing: AlarmRecipient | null
  onClose: () => void
}) {
  const create = useCreateAlarmRecipient(anlageId)
  const update = useUpdateAlarmRecipient(anlageId)
  const del = useDeleteAlarmRecipient(anlageId)

  const [type, setType] = useState<AlarmRecipientType>(editing?.type ?? 'EMAIL')
  const [target, setTarget] = useState(editing?.target ?? '')
  const [label, setLabel] = useState(editing?.label ?? '')
  const [priorities, setPriorities] = useState<AlarmPriority[]>(editing?.priorities ?? [])
  const [delayMinutes, setDelayMinutes] = useState(editing?.delayMinutes ?? 0)
  const [isActive, setIsActive] = useState(editing?.isActive ?? true)
  const [schedule, setSchedule] = useState<RecipientSchedule>(() =>
    editing?.schedule && editing.schedule.mode === 'weekly' && editing.schedule.days
      ? { mode: 'weekly', days: editing.schedule.days.map((d) => ({ ...d })) }
      : defaultSchedule()
  )

  const save = async () => {
    if (!target.trim()) return
    const data = {
      type,
      target: target.trim(),
      label: label.trim() || null,
      priorities,
      delayMinutes,
      isActive,
      schedule: schedule.mode === 'always' ? { mode: 'always' as const } : schedule,
    }
    if (editing) {
      await update.mutateAsync({ id: editing.id, ...data })
    } else {
      await create.mutateAsync(data)
    }
    onClose()
  }

  const remove = async () => {
    if (!editing) return
    if (!window.confirm('Empfänger wirklich löschen?')) return
    await del.mutateAsync(editing.id)
    onClose()
  }

  const setDay = (i: number, patch: Partial<RecipientScheduleDay>) => {
    setSchedule((s) => ({
      ...s,
      days: (s.days ?? defaultSchedule().days!).map((d, idx) => idx === i ? { ...d, ...patch } : d),
    }))
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" key={editing?.id ?? 'new'}>
      <DialogTitle>{editing ? 'Empfänger bearbeiten' : 'Empfänger hinzufügen'}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Kanal</InputLabel>
            <Select value={type} label="Kanal" onChange={(e) => setType(e.target.value as AlarmRecipientType)}>
              <MenuItem value="EMAIL">Email</MenuItem>
              <MenuItem value="SMS" disabled>SMS (bald verfügbar)</MenuItem>
              <MenuItem value="TELEGRAM" disabled>Telegram (bald verfügbar)</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label={type === 'EMAIL' ? 'E-Mail-Adresse' : type === 'SMS' ? 'Telefonnummer (+41…)' : 'Telegram-Chat-ID'}
            fullWidth size="small"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            autoFocus
          />

          <TextField
            label="Anzeigename (optional)"
            fullWidth size="small"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="z.B. Bereitschaft Müller"
          />

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>Prioritäten</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Keine Auswahl = alle Prioritäten werden versendet.
            </Typography>
            <Stack direction="row" gap={0.5} flexWrap="wrap">
              {PRIORITIES.map((p) => (
                <FormControlLabel
                  key={p}
                  control={
                    <Checkbox
                      size="small"
                      checked={priorities.includes(p)}
                      onChange={(e) => setPriorities((prev) =>
                        e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                      )}
                    />
                  }
                  label={PRIO_LABEL[p]}
                />
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>Zeitplan</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Alarme ausserhalb des Zeitplans werden nicht an diesen Empfänger versendet
              – sie werden <strong>nicht</strong> nachgeholt.
            </Typography>
            <RadioGroup
              row
              value={schedule.mode}
              onChange={(e) => setSchedule((s) => ({ ...s, mode: e.target.value as 'always' | 'weekly' }))}
            >
              <FormControlLabel value="always" control={<Radio size="small" />} label="Immer" />
              <FormControlLabel value="weekly" control={<Radio size="small" />} label="Wochenplan" />
            </RadioGroup>

            {schedule.mode === 'weekly' && (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 1, alignItems: 'center', mt: 1 }}>
                {(schedule.days ?? defaultSchedule().days!).map((d, i) => (
                  <Box key={i} sx={{ display: 'contents' }}>
                    <FormControlLabel
                      control={<Checkbox size="small" checked={d.enabled} onChange={(e) => setDay(i, { enabled: e.target.checked })} />}
                      label={DAY_LABELS[i]}
                    />
                    <Box />
                    <TextField
                      type="time" size="small"
                      value={d.start}
                      disabled={!d.enabled}
                      onChange={(e) => setDay(i, { start: e.target.value })}
                      sx={{ width: 110 }}
                    />
                    <TextField
                      type="time" size="small"
                      value={d.end}
                      disabled={!d.enabled}
                      onChange={(e) => setDay(i, { end: e.target.value })}
                      sx={{ width: 110 }}
                    />
                  </Box>
                ))}
                <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1', mt: 0.5 }}>
                  Tipp: Endzeit vor Startzeit ergibt ein Fenster über Mitternacht (z.&nbsp;B. 22:00 → 06:00).
                </Typography>
              </Box>
            )}
          </Box>

          <TextField
            label="Verzögerung (Minuten)"
            type="number"
            fullWidth size="small"
            value={delayMinutes}
            onChange={(e) => setDelayMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
            helperText="0 = sofort. Kann für Eskalationsstufen genutzt werden."
          />

          <FormControlLabel
            control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
            label="Aktiv"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Box>
          {editing && (
            <Button color="error" startIcon={<DeleteIcon />} onClick={remove}>
              Löschen
            </Button>
          )}
        </Box>
        <Box>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="contained" onClick={save} disabled={!target.trim() || create.isPending || update.isPending}>
            Speichern
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
