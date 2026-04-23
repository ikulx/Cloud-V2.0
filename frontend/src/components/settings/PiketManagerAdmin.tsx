import { useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Alert from '@mui/material/Alert'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import GroupIcon from '@mui/icons-material/Group'
import MapIcon from '@mui/icons-material/Map'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import HistoryIcon from '@mui/icons-material/History'
import {
  usePiketRegions, useCreatePiketRegion, useUpdatePiketRegion, useDeletePiketRegion,
  usePiketShifts,
  usePiketLog,
  type PiketRegion,
} from '../../features/piket/queries'
import { useUsers } from '../../features/users/queries'
import { ShiftsPlanner } from '../piket/ShiftsPlanner'

export function PiketManagerAdmin() {
  const [open, setOpen] = useState(false)
  const { data: regions = [] } = usePiketRegions()
  const { data: shifts = [] } = usePiketShifts(
    {
      from: new Date().toISOString().slice(0, 10),
      to:   new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    },
    open, // nur laden wenn Popup offen
  )

  const todayStr = new Date().toISOString().slice(0, 10)
  const todaysShifts = shifts.filter((s) => s.date.startsWith(todayStr))

  return (
    <>
      <Card>
        <CardContent sx={{ pt: 3 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <GroupIcon fontSize="small" color="action" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>Piket-Manager</Typography>
              <Typography variant="caption" color="text.secondary">
                {regions.length === 0
                  ? 'Noch keine Bereiche angelegt'
                  : `${regions.length} Bereich${regions.length === 1 ? '' : 'e'}`}
                {todaysShifts.length > 0 && ` · heute ${todaysShifts.length} Schicht(en) eingeteilt`}
              </Typography>
            </Box>
            <Button variant="outlined" size="small" onClick={() => setOpen(true)}>
              Verwalten
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>Piket-Manager</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <PiketTabs />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Schliessen</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

// ── Tab-Container ──────────────────────────────────────────────────────────
function PiketTabs() {
  const [tab, setTab] = useState(0)
  return (
    <>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
        <Tab icon={<MapIcon fontSize="small" />} iconPosition="start" label="Bereiche" />
        <Tab icon={<CalendarMonthIcon fontSize="small" />} iconPosition="start" label="Schichten" />
        <Tab icon={<HistoryIcon fontSize="small" />} iconPosition="start" label="Log" />
      </Tabs>
      <Box sx={{ p: 2 }}>
        {tab === 0 && <RegionsPanel />}
        {tab === 1 && <ShiftsPlanner />}
        {tab === 2 && <LogPanel />}
      </Box>
    </>
  )
}

// ── Bereiche-Panel ─────────────────────────────────────────────────────────
export function RegionsPanel() {
  const { data: regions = [], isLoading } = usePiketRegions()
  const del = useDeletePiketRegion()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          PLZ-Bereiche und Ausland-Präfixe („DE-", „AT-") legen fest, welcher
          Bereich bei einer Anlage greift.
        </Typography>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          Neuer Bereich
        </Button>
      </Stack>

      {isLoading ? (
        <Typography variant="body2" color="text.secondary">Lädt …</Typography>
      ) : regions.length === 0 ? (
        <Alert severity="info">Noch keine Bereiche. Lege mindestens einen an, damit der Piket-Manager Alarme zuordnen kann.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Bereich</TableCell>
              <TableCell>Abdeckung</TableCell>
              <TableCell>Bereichsleiter</TableCell>
              <TableCell sx={{ width: 140 }}>Eskalation</TableCell>
              <TableCell sx={{ width: 90 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {regions.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>{r.name}</Typography>
                  {r.description && (
                    <Typography variant="caption" color="text.secondary">{r.description}</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Stack direction="row" gap={0.5} flexWrap="wrap">
                    {r.zipRanges.map((z) => (
                      <Chip key={z.id ?? `${z.fromZip}-${z.toZip}`} size="small"
                        label={z.fromZip === z.toZip ? String(z.fromZip) : `${z.fromZip}–${z.toZip}`} />
                    ))}
                    {r.foreignPrefixes.map((p, i) => (
                      <Chip key={p.id ?? p.prefix + i} size="small" color="info" label={p.prefix} />
                    ))}
                    {r.zipRanges.length + r.foreignPrefixes.length === 0 && <em>—</em>}
                  </Stack>
                </TableCell>
                <TableCell>
                  {r.leader ? `${r.leader.firstName} ${r.leader.lastName}` : (r.leaderFallbackEmail ?? <em style={{ color: '#999' }}>—</em>)}
                </TableCell>
                <TableCell sx={{ fontSize: 12 }}>
                  SMS→Anruf: {r.smsToCallMinutes ?? 5} min<br />
                  Anruf→Leiter: {r.callToLeaderMinutes ?? 5} min
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => setEditingId(r.id)}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => {
                    if (window.confirm(`Bereich "${r.name}" wirklich löschen?`)) void del.mutate(r.id)
                  }}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <RegionDialog
        open={creating || editingId !== null}
        region={editingId ? regions.find((r) => r.id === editingId) ?? null : null}
        onClose={() => { setCreating(false); setEditingId(null) }}
      />
    </Box>
  )
}

function RegionDialog({
  open, region, onClose,
}: {
  open: boolean
  region: PiketRegion | null
  onClose: () => void
}) {
  const create = useCreatePiketRegion()
  const update = useUpdatePiketRegion()
  const { data: users = [] } = useUsers()
  const isEdit = !!region

  const [name, setName] = useState(region?.name ?? '')
  const [description, setDescription] = useState(region?.description ?? '')
  const [leaderId, setLeaderId] = useState(region?.leaderId ?? '')
  const [leaderFallbackEmail, setLeaderFallbackEmail] = useState(region?.leaderFallbackEmail ?? '')
  const [smsToCallMinutes, setSmsToCallMinutes] = useState<string>(region?.smsToCallMinutes != null ? String(region.smsToCallMinutes) : '')
  const [callToLeaderMinutes, setCallToLeaderMinutes] = useState<string>(region?.callToLeaderMinutes != null ? String(region.callToLeaderMinutes) : '')
  const [zipRanges, setZipRanges] = useState<{ fromZip: number; toZip: number }[]>(
    region?.zipRanges.map((z) => ({ fromZip: z.fromZip, toZip: z.toZip })) ?? [],
  )
  const [foreignPrefixes, setForeignPrefixes] = useState<string[]>(
    region?.foreignPrefixes.map((p) => p.prefix) ?? [],
  )

  const [newFrom, setNewFrom] = useState('')
  const [newTo, setNewTo] = useState('')
  const [newPrefix, setNewPrefix] = useState('')

  const save = async () => {
    if (!name.trim()) return
    const payload = {
      name: name.trim(),
      description: description || null,
      leaderId: leaderId || null,
      leaderFallbackEmail: leaderFallbackEmail.trim() || null,
      smsToCallMinutes:    smsToCallMinutes    === '' ? null : parseInt(smsToCallMinutes, 10),
      callToLeaderMinutes: callToLeaderMinutes === '' ? null : parseInt(callToLeaderMinutes, 10),
      zipRanges,
      foreignPrefixes,
    }
    if (isEdit && region) {
      await update.mutateAsync({ id: region.id, ...payload })
    } else {
      await create.mutateAsync(payload)
    }
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" key={region?.id ?? 'new'}>
      <DialogTitle>{isEdit ? `Bereich bearbeiten: ${region?.name}` : 'Neuer Bereich'}</DialogTitle>
      <DialogContent dividers>
        <Stack gap={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Name *" size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <TextField label="Beschreibung" size="small" fullWidth value={description ?? ''} onChange={(e) => setDescription(e.target.value)} />
          </Stack>

          <Divider textAlign="left" sx={{ my: 1 }}>Abdeckung</Divider>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <TextField size="small" label="PLZ von" type="number" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} sx={{ width: 110 }} />
            <TextField size="small" label="PLZ bis" type="number" value={newTo}   onChange={(e) => setNewTo(e.target.value)}   sx={{ width: 110 }} />
            <Button size="small" variant="outlined" onClick={() => {
              const a = parseInt(newFrom, 10); const b = parseInt(newTo, 10)
              if (!Number.isFinite(a) || !Number.isFinite(b)) return
              setZipRanges((x) => [...x, { fromZip: Math.min(a, b), toZip: Math.max(a, b) }])
              setNewFrom(''); setNewTo('')
            }}>+ PLZ</Button>
            <Box sx={{ mx: 1, color: 'text.disabled' }}>|</Box>
            <TextField size="small" label="Ausland-Präfix (DE-, AT-, …)" value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} sx={{ width: 220 }} />
            <Button size="small" variant="outlined" onClick={() => {
              const v = newPrefix.trim().toUpperCase()
              if (!v) return
              setForeignPrefixes((x) => x.includes(v) ? x : [...x, v])
              setNewPrefix('')
            }}>+ Präfix</Button>
          </Stack>
          <Stack direction="row" gap={0.5} flexWrap="wrap">
            {zipRanges.map((z, i) => (
              <Chip key={'z' + i} label={z.fromZip === z.toZip ? String(z.fromZip) : `${z.fromZip}–${z.toZip}`}
                onDelete={() => setZipRanges((x) => x.filter((_, j) => j !== i))} />
            ))}
            {foreignPrefixes.map((p, i) => (
              <Chip key={'p' + i} color="info" label={p} onDelete={() => setForeignPrefixes((x) => x.filter((v) => v !== p))} />
            ))}
          </Stack>

          <Divider textAlign="left" sx={{ my: 1 }}>Bereichsleiter &amp; Eskalation</Divider>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl size="small" fullWidth>
              <InputLabel>Bereichsleiter (User)</InputLabel>
              <Select
                label="Bereichsleiter (User)"
                value={leaderId ?? ''}
                onChange={(e) => setLeaderId(e.target.value as string)}
              >
                <MenuItem value=""><em>– kein Leader –</em></MenuItem>
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="Fallback-E-Mail" size="small" fullWidth type="email"
              value={leaderFallbackEmail ?? ''} onChange={(e) => setLeaderFallbackEmail(e.target.value)} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" label="SMS → Anruf (Min.)" type="number" value={smsToCallMinutes} onChange={(e) => setSmsToCallMinutes(e.target.value)} sx={{ flex: 1 }} helperText="leer = globaler Default (5 min)" />
            <TextField size="small" label="Anruf → Leiter (Min.)" type="number" value={callToLeaderMinutes} onChange={(e) => setCallToLeaderMinutes(e.target.value)} sx={{ flex: 1 }} helperText="leer = globaler Default (5 min)" />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={() => void save()} disabled={!name.trim()}>Speichern</Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Schichten-Panel (nutzt den neuen Planner) ─────────────────────────────
export function ShiftsPanel() {
  return <ShiftsPlanner />
}

// ── Log-Panel ──────────────────────────────────────────────────────────────
const STATE_LABEL: Record<string, string> = {
  PENDING_SMS: 'SMS ausstehend',
  SMS_SENT: 'SMS gesendet',
  CALL_DUE: 'Anruf fällig',
  CALL_SENT: 'Anruf gesendet',
  LEADER_DUE: 'Leiter fällig',
  LEADER_SENT: 'Leiter alarmiert',
  ACKNOWLEDGED: 'bestätigt',
  NO_TECH_FOUND: 'keine Zuordnung',
}
const STATE_COLOR: Record<string, 'default' | 'info' | 'warning' | 'error' | 'success'> = {
  PENDING_SMS: 'info', SMS_SENT: 'info',
  CALL_DUE: 'warning', CALL_SENT: 'warning',
  LEADER_DUE: 'error', LEADER_SENT: 'error',
  ACKNOWLEDGED: 'success', NO_TECH_FOUND: 'default',
}

export function LogPanel() {
  const [days, setDays] = useState(30)
  const { data: rows = [], isLoading } = usePiketLog(days)

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          Alle Piket-Alarme der letzten Tage, inkl. Zeitstempel und Eskalations-Schritten.
        </Typography>
        <FormControl size="small" sx={{ width: 140 }}>
          <InputLabel>Zeitraum</InputLabel>
          <Select label="Zeitraum" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <MenuItem value={7}>7 Tage</MenuItem>
            <MenuItem value={30}>30 Tage</MenuItem>
            <MenuItem value={90}>90 Tage</MenuItem>
            <MenuItem value={365}>1 Jahr</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {isLoading ? (
        <Typography variant="body2" color="text.secondary">Lädt …</Typography>
      ) : rows.length === 0 ? (
        <Alert severity="info">Keine Einträge im Zeitraum.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 160 }}>Ausgelöst</TableCell>
              <TableCell>Alarm / Anlage</TableCell>
              <TableCell>Bereich / Techniker</TableCell>
              <TableCell>Zeitleiste</TableCell>
              <TableCell sx={{ width: 160 }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const activated = new Date(r.alarmEvent.activatedAt)
              return (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {activated.toLocaleString('de-CH')}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {r.alarmEvent.anlage?.name ?? '—'}
                      {r.alarmEvent.anlage?.projectNumber && (
                        <Typography variant="caption" color="text.secondary"> · {r.alarmEvent.anlage.projectNumber}</Typography>
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {r.alarmEvent.priority} · {r.alarmEvent.message}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontSize: 13 }}>
                    {r.region?.name ?? <em>—</em>}
                    {r.techUser && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {r.techUser.firstName} {r.techUser.lastName}
                        {r.techUser.phone && ` · ${r.techUser.phone}`}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    <Stack direction="column" gap={0.25}>
                      {r.smsAt    && <span>📱 SMS  {new Date(r.smsAt).toLocaleTimeString('de-CH')}</span>}
                      {r.callAt   && <span>📞 Anruf {new Date(r.callAt).toLocaleTimeString('de-CH')}</span>}
                      {r.leaderAt && <span>🛎️ Leiter {new Date(r.leaderAt).toLocaleTimeString('de-CH')}</span>}
                      {r.acknowledgedAt && (
                        <span style={{ color: '#2e7d32' }}>✓ Bestätigt {new Date(r.acknowledgedAt).toLocaleTimeString('de-CH')}
                          {r.acknowledgedBy && ` von ${r.acknowledgedBy.firstName} ${r.acknowledgedBy.lastName}`}
                        </span>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={STATE_COLOR[r.state] ?? 'default'} label={STATE_LABEL[r.state] ?? r.state} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Box>
  )
}
