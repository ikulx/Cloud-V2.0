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
  useAlarmEvents, normalizeSchedule, useInternalAlarmTemplates,
  type AlarmRecipient, type AlarmPriority, type AlarmRecipientType, type AlarmEvent,
  type RecipientSchedule,
} from '../../features/alarms/queries'
import { useAnlage, useUpdateAnlage } from '../../features/anlagen/queries'
import { useSession } from '../../context/SessionContext'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import LockIcon from '@mui/icons-material/Lock'
import { ScheduleEditor } from './ScheduleEditor'

const PRIORITIES: AlarmPriority[] = ['PRIO1', 'PRIO2', 'PRIO3', 'WARNING', 'INFO']
const PRIO_LABEL: Record<AlarmPriority, string> = {
  PRIO1: 'Prio 1', PRIO2: 'Prio 2', PRIO3: 'Prio 3', WARNING: 'Warnung', INFO: 'Info',
}
const PRIO_COLOR: Record<AlarmPriority, 'error' | 'warning' | 'info' | 'default'> = {
  PRIO1: 'error', PRIO2: 'error', PRIO3: 'warning', WARNING: 'warning', INFO: 'info',
}

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function defaultSchedule(): RecipientSchedule {
  return { mode: 'always' }
}

/** Serialisiert die Zeitfenster eines Tages als vergleichbaren String. */
function windowsKey(ws: Array<{ start: string; end: string }>): string {
  return ws.map((w) => `${w.start}-${w.end}`).join(',')
}

/** Menschlich lesbare Kurzform des Zeitplans, z.B. "Mo–Fr 08–17, Sa 09–12" */
function formatScheduleSummary(raw: RecipientSchedule | null | undefined): string {
  const s = normalizeSchedule(raw)
  if (!s || s.mode !== 'weekly' || !s.days) return 'immer'
  const active = s.days
    .map((d, i) => (d.enabled && d.windows.length > 0 ? i : -1))
    .filter((i) => i >= 0)
  if (active.length === 0) return 'nie aktiv'

  // Gruppiere aufeinanderfolgende Tage mit identischen Fenster-Signaturen.
  interface Group { start: number; end: number; key: string; label: string }
  const groups: Group[] = []
  for (const i of active) {
    const key = windowsKey(s.days[i].windows)
    const last = groups[groups.length - 1]
    if (last && last.end === i - 1 && last.key === key) {
      last.end = i
    } else {
      const label = s.days[i].windows.map((w) => `${w.start}–${w.end}`).join(' + ')
      groups.push({ start: i, end: i, key, label })
    }
  }

  const parts = groups.map((g) => {
    const range = g.start === g.end
      ? DAY_LABELS[g.start]
      : `${DAY_LABELS[g.start]}–${DAY_LABELS[g.end]}`
    return `${range} ${g.label}`
  })
  return parts.join(', ')
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
  const { me } = useSession()
  const isAdmin = me?.roleName === 'admin' || me?.roleName === 'verwalter' || me?.isSystemRole === true
  const { data: anlage } = useAnlage(anlageId)
  const updateAnlage = useUpdateAnlage(anlageId)
  const { data: recipients = [], isLoading: rLoading } = useAlarmRecipients(anlageId)
  // Bewusst nur aktive Events – die Cloud zeigt nicht mehr die volle Historie.
  const { data: events = [], isLoading: eLoading } = useAlarmEvents({
    anlageId, status: 'ACTIVE', limit: 100,
  })

  // Split extern / intern. Nicht-Admins bekommen intern schon vom Backend
  // gefiltert, aber UI zeigt auch im Frontend keinen Abschnitt.
  const externalRecipients = recipients.filter((r) => !r.isInternal)
  const internalRecipients = recipients.filter((r) => r.isInternal)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AlarmRecipient | null>(null)
  const [newKind, setNewKind] = useState<'external' | 'internal'>('external')

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

      {/* ── Externe Empfänger ───────────────────────────── */}
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6">Alarm-Empfänger</Typography>
            <Typography variant="caption" color="text.secondary">
              Wer wird bei einem Alarm dieser Anlage benachrichtigt? Empfänger
              ohne aktiven Zeitplan-Eintrag zum Alarm­zeitpunkt bekommen keine
              Meldung (auch keine nachträgliche).
            </Typography>
          </Box>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => { setEditing(null); setNewKind('external'); setDialogOpen(true) }}
          >
            Empfänger hinzufügen
          </Button>
        </Box>

        <RecipientTable
          recipients={externalRecipients}
          loading={rLoading}
          onEdit={(r) => { setEditing(r); setNewKind('external'); setDialogOpen(true) }}
        />
      </Paper>

      {/* ── Interne Empfänger (nur Admin/Verwalter) ─────── */}
      {isAdmin && (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', p: 2, bgcolor: 'action.hover' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, gap: 2 }}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LockIcon fontSize="small" color="action" />
                <Typography variant="h6">Interne Empfänger</Typography>
                <Chip size="small" label="nur Admin" />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Kunden sehen diese Empfänger nicht. Die E-Mail-Adressen werden
                zentral unter <strong>Einstellungen → Alarme</strong> gepflegt;
                hier legen Sie pro Anlage fest, welche Templates aktiv sind und
                mit welchen Prioritäten / Zeitplänen / Verzögerungen.
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => { setEditing(null); setNewKind('internal'); setDialogOpen(true) }}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Intern hinzufügen
            </Button>
          </Box>

          <RecipientTable
            recipients={internalRecipients}
            loading={rLoading}
            onEdit={(r) => { setEditing(r); setNewKind('internal'); setDialogOpen(true) }}
            isInternal
          />
        </Paper>
      )}

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
        kind={editing ? (editing.isInternal ? 'internal' : 'external') : newKind}
        onClose={() => setDialogOpen(false)}
      />
    </Stack>
  )
}

// ─── Gemeinsame Tabelle für externe & interne Empfänger ────────────────────

function RecipientTable({
  recipients, loading, onEdit, isInternal,
}: {
  recipients: AlarmRecipient[]
  loading: boolean
  onEdit: (r: AlarmRecipient) => void
  isInternal?: boolean
}) {
  if (loading) return <Typography variant="body2" color="text.secondary">Lädt …</Typography>
  if (recipients.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
        {isInternal
          ? 'Keine internen Empfänger für diese Anlage aktiviert.'
          : 'Noch keine Empfänger. Fügen Sie mindestens einen hinzu, damit Alarme zugestellt werden.'}
      </Typography>
    )
  }
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{isInternal ? 'Empfänger' : 'Kanal'}</TableCell>
            <TableCell>{isInternal ? 'E-Mail (aktuell)' : 'Ziel'}</TableCell>
            <TableCell>Label</TableCell>
            <TableCell>Prioritäten</TableCell>
            <TableCell>Zeitplan</TableCell>
            <TableCell>Verzög.</TableCell>
            <TableCell align="center">Aktiv</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {recipients.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell>
                {isInternal ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <LockIcon fontSize="small" color="action" />
                    <Typography variant="body2" fontWeight={500}>
                      {r.template?.label ?? (r.templateId ? '— (Template entfernt)' : 'Eigene Adresse')}
                    </Typography>
                    {r.template?.isSystem && <Chip size="small" label="System" />}
                    {!r.templateId && <Chip size="small" label="Custom" variant="outlined" />}
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TypeIcon type={r.type} />{r.type}
                  </Box>
                )}
              </TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 13 }}>
                {isInternal
                  ? (r.templateId
                      ? (r.template?.email || <em style={{ color: '#9e9e9e' }}>– keine E-Mail gepflegt –</em>)
                      : (r.target || <em style={{ color: '#9e9e9e' }}>–</em>))
                  : r.target}
              </TableCell>
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
              <TableCell sx={{ fontSize: 13 }}>{r.delayMinutes === 0 ? 'sofort' : `+${r.delayMinutes} min`}</TableCell>
              <TableCell align="center">
                {r.isActive
                  ? <CheckCircleIcon fontSize="small" color="success" />
                  : <CancelIcon fontSize="small" color="disabled" />}
              </TableCell>
              <TableCell align="right">
                <Tooltip title="Bearbeiten">
                  <IconButton size="small" onClick={() => onEdit(r)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
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
  open, anlageId, editing, kind, onClose,
}: {
  open: boolean
  anlageId: string
  editing: AlarmRecipient | null
  kind: 'external' | 'internal'
  onClose: () => void
}) {
  const create = useCreateAlarmRecipient(anlageId)
  const update = useUpdateAlarmRecipient(anlageId)
  const del = useDeleteAlarmRecipient(anlageId)
  const { data: templates = [] } = useInternalAlarmTemplates(kind === 'internal' || editing?.isInternal === true)

  const [type, setType] = useState<AlarmRecipientType>(editing?.type ?? 'EMAIL')
  const [target, setTarget] = useState(editing?.target ?? '')
  const [label, setLabel] = useState(editing?.label ?? '')
  const [priorities, setPriorities] = useState<AlarmPriority[]>(editing?.priorities ?? [])
  const [delayMinutes, setDelayMinutes] = useState(editing?.delayMinutes ?? 0)
  const [isActive, setIsActive] = useState(editing?.isActive ?? true)
  const [schedule, setSchedule] = useState<RecipientSchedule>(() => {
    const norm = normalizeSchedule(editing?.schedule)
    return norm ?? defaultSchedule()
  })
  const [templateId, setTemplateId] = useState<string>(editing?.templateId ?? '')
  // Sub-Modus bei internen Empfängern: Template (Piketdienst/Ygnis PM) oder
  // eigene E-Mail-Adresse, die nur zu dieser Anlage gehört.
  const [internalKind, setInternalKind] = useState<'template' | 'custom'>(
    editing?.templateId ? 'template' : (editing?.isInternal ? 'custom' : 'template'),
  )
  const isInternal = kind === 'internal'
  const useTemplate = isInternal && internalKind === 'template'

  const save = async () => {
    if (isInternal && internalKind === 'template' && !templateId) return
    if ((!isInternal || internalKind === 'custom') && !target.trim()) return
    const cleanSchedule: RecipientSchedule =
      schedule.mode === 'always' ? { mode: 'always' } : schedule
    const data = {
      type: isInternal ? ('EMAIL' as AlarmRecipientType) : type,
      // Bei Template-Empfängern bleibt target leer, die Adresse kommt aus dem
      // Template. Bei Custom-Internen und Externen direkt aus dem Eingabefeld.
      target: useTemplate ? '' : target.trim(),
      label: label.trim() || null,
      priorities,
      delayMinutes,
      isActive,
      schedule: cleanSchedule,
      isInternal,
      templateId: useTemplate ? (templateId || null) : null,
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

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" key={editing?.id ?? `new-${kind}`}>
      <DialogTitle>
        {editing ? 'Empfänger bearbeiten' : (isInternal ? 'Internen Empfänger hinzufügen' : 'Empfänger hinzufügen')}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          {isInternal ? (
            <>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  Typ des internen Empfängers
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Button
                    size="small"
                    variant={internalKind === 'template' ? 'contained' : 'outlined'}
                    onClick={() => setInternalKind('template')}
                  >
                    Piketdienst / Ygnis PM
                  </Button>
                  <Button
                    size="small"
                    variant={internalKind === 'custom' ? 'contained' : 'outlined'}
                    onClick={() => setInternalKind('custom')}
                  >
                    Eigene Adresse
                  </Button>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  {internalKind === 'template'
                    ? 'E-Mail-Adresse wird zentral unter „Einstellungen → Alarme" gepflegt und gilt für alle Anlagen.'
                    : 'Eigene, nur zu dieser Anlage gehörende Adresse. Kunden bleiben weiterhin unsichtbar.'}
                </Typography>
              </Box>

              {internalKind === 'template' ? (
                <FormControl fullWidth size="small">
                  <InputLabel>Template</InputLabel>
                  <Select
                    value={templateId}
                    label="Template"
                    onChange={(e) => setTemplateId(e.target.value as string)}
                  >
                    {templates.map((t) => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.label}
                        {t.email ? <span style={{ color: '#9e9e9e', marginLeft: 8, fontSize: 12 }}>{t.email}</span>
                                 : <span style={{ color: '#f44336', marginLeft: 8, fontSize: 12 }}>(keine E-Mail gepflegt)</span>}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <TextField
                  label="E-Mail-Adresse"
                  type="email"
                  fullWidth size="small"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  autoFocus
                  placeholder="intern@example.com"
                />
              )}
            </>
          ) : (
            <>
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
            </>
          )}

          <TextField
            label="Anzeigename (optional)"
            fullWidth size="small"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={isInternal ? 'z.B. Nur Wochenende' : 'z.B. Bereitschaft Müller'}
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
            <Typography variant="body2" sx={{ mb: 0.5 }}>Zeitplan</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Alarme ausserhalb des Zeitplans werden <strong>nicht</strong> an diesen
              Empfänger versendet – sie werden auch nicht nachgeholt.
            </Typography>
            <ScheduleEditor value={schedule} onChange={setSchedule} />
          </Box>

          <TextField
            label="Verzögerung (Minuten)"
            type="number"
            fullWidth size="small"
            value={delayMinutes}
            onChange={(e) => setDelayMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
            helperText="0 = sofort. Gilt NUR wenn der Alarm-Zeitpunkt im Zeitplan liegt – dann wird der Versand um so viele Minuten verzögert. Sinnvoll für Eskalationsstufen (z.B. 15 min später an Bereitschaftsleiter)."
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
          <Button
            variant="contained"
            onClick={save}
            disabled={
              (useTemplate ? !templateId : !target.trim()) ||
              create.isPending || update.isPending
            }
          >
            Speichern
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  )
}
