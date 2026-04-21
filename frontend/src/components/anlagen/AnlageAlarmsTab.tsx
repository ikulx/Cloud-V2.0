import { useState } from 'react'
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
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EmailIcon from '@mui/icons-material/Email'
import SmsIcon from '@mui/icons-material/Sms'
import TelegramIcon from '@mui/icons-material/Telegram'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import {
  useAlarmRecipients, useCreateAlarmRecipient, useUpdateAlarmRecipient, useDeleteAlarmRecipient,
  useAlarmEvents, useAcknowledgeAlarm,
  type AlarmRecipient, type AlarmPriority, type AlarmRecipientType, type AlarmEvent,
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
  const { data: events = [], isLoading: eLoading } = useAlarmEvents({ anlageId, limit: 100 })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AlarmRecipient | null>(null)

  const offlineMonitoring = anlage?.offlineMonitoringEnabled ?? true

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

      {/* ── Empfänger ───────────────────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6">Alarm-Empfänger</Typography>
            <Typography variant="caption" color="text.secondary">
              Wer wird bei einem Alarm dieser Anlage benachrichtigt?
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
                  <TableCell align="center">Verzögerung</TableCell>
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
                    <TableCell align="center">{r.delayMinutes === 0 ? 'sofort' : `${r.delayMinutes} min`}</TableCell>
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

      {/* ── Alarm-Historie ─────────────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2 }}>
        <Typography variant="h6">Alarm-Historie</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Letzte 100 Alarme dieser Anlage
        </Typography>
        <Divider sx={{ mb: 2 }} />

        {eLoading ? (
          <Typography variant="body2" color="text.secondary">Lädt …</Typography>
        ) : events.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Noch keine Alarme aufgetreten.
          </Typography>
        ) : (
          <AlarmEventList events={events} />
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

// ─── Event-Liste ──────────────────────────────────────────────────────────────

function AlarmEventList({ events }: { events: AlarmEvent[] }) {
  const ack = useAcknowledgeAlarm()
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Zeit</TableCell>
            <TableCell>Priorität</TableCell>
            <TableCell>Meldung</TableCell>
            <TableCell>Gerät</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Versand</TableCell>
            <TableCell align="right" />
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
                <TableCell>
                  {e.status === 'ACTIVE' && <Chip size="small" label="Aktiv" color="error" />}
                  {e.status === 'CLEARED' && <Chip size="small" label="Zurückgefallen" color="success" variant="outlined" />}
                  {e.status === 'ACKNOWLEDGED' && <Chip size="small" label="Quittiert" color="default" variant="outlined" />}
                </TableCell>
                <TableCell sx={{ fontSize: 12 }}>
                  {sentCount > 0 && <span style={{ color: '#4caf50' }}>✓ {sentCount}</span>}
                  {failedCount > 0 && <span style={{ color: '#f44336', marginLeft: 6 }}>✗ {failedCount}</span>}
                  {skippedCount > 0 && <span style={{ color: '#9e9e9e', marginLeft: 6 }}>– {skippedCount}</span>}
                  {e.deliveries.length === 0 && <span style={{ color: '#9e9e9e' }}>—</span>}
                </TableCell>
                <TableCell align="right">
                  {e.status === 'ACTIVE' && (
                    <Button
                      size="small"
                      onClick={() => ack.mutate(e.id)}
                      disabled={ack.isPending}
                    >
                      Quittieren
                    </Button>
                  )}
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

  // Dialog-Inhalte bei Öffnen mit editing syncen.
  // Wird mit `key={editing?.id}` vom Caller neu gemountet – daher reicht useState-Init.
  // (siehe Dialog-Wrapping unten)
  // Beim ersten Render stimmen die States mit editing überein.

  const save = async () => {
    const data = {
      type,
      target: target.trim(),
      label: label.trim() || null,
      priorities,
      delayMinutes,
      isActive,
    }
    if (!data.target) return
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
