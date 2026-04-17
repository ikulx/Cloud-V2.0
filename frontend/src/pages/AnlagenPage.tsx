import { useState } from 'react'
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
import Drawer from '@mui/material/Drawer'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Divider from '@mui/material/Divider'
import Chip from '@mui/material/Chip'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Snackbar from '@mui/material/Snackbar'
import AddIcon from '@mui/icons-material/Add'
import MapIcon from '@mui/icons-material/Map'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WarningIcon from '@mui/icons-material/Warning'
import AssignmentLateIcon from '@mui/icons-material/AssignmentLate'
import { useNavigate } from 'react-router-dom'
import { useAnlagen, useCreateAnlage, useDeleteAnlage } from '../features/anlagen/queries'
import { useUsers } from '../features/users/queries'
import { useGroups } from '../features/groups/queries'
import { useDevices } from '../features/devices/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SearchableMultiSelect } from '../components/SearchableMultiSelect'
import { usePermission } from '../hooks/usePermission'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { geocodeAddress } from '../lib/geocode'
import { useTranslation } from 'react-i18next'
import type { Anlage, Device } from '../types/model'

const EMPTY_FORM = {
  projectNumber: '', name: '', description: '', street: '', zip: '', city: '', country: 'Schweiz',
  contactName: '', contactPhone: '', contactMobile: '', contactEmail: '', notes: '',
  latitude: '', longitude: '',
  hasHeatPump: false,
  hasBoiler: false,
}
const EMPTY_ASSIGN = { deviceIds: [] as string[], userIds: [] as string[], groupIds: [] as string[] }

type AnlageStatus = 'OK' | 'TODO' | 'ERROR' | 'OFFLINE' | 'EMPTY'

function computeAnlageStatus(devices: Device[]): AnlageStatus {
  if (devices.length === 0) return 'EMPTY'
  // Priorität: OFFLINE > ERROR > TODO > OK
  const hasOffline = devices.some((d) => d.status !== 'ONLINE')
  if (hasOffline) return 'OFFLINE'
  const hasError = devices.some((d) => d.hasError === true)
  if (hasError) return 'ERROR'
  const hasTodos = devices.some((d) => (d._count?.todos ?? 0) > 0)
  if (hasTodos) return 'TODO'
  return 'OK'
}

function StatusChip({ status }: { status: AnlageStatus }) {
  switch (status) {
    case 'OK':
      return <Chip icon={<CheckCircleIcon />} label="OK" color="success" size="small" sx={{ fontWeight: 600 }} />
    case 'TODO':
      return <Chip icon={<AssignmentLateIcon />} label="Todos offen" color="warning" size="small" sx={{ fontWeight: 600 }} />
    case 'ERROR':
      return <Chip icon={<WarningIcon />} label="Fehler" color="warning" size="small" sx={{ fontWeight: 600, bgcolor: 'warning.dark', color: 'common.white' }} />
    case 'OFFLINE':
      return <Chip icon={<ErrorIcon />} label="Offline" color="error" size="small" sx={{ fontWeight: 600 }} />
    case 'EMPTY':
      return <Chip label="—" size="small" variant="outlined" />
  }
}

export function AnlagenPage() {
  const { data: anlagen, isLoading } = useAnlagen()
  const { data: allUsers } = useUsers()
  const { data: allGroups } = useGroups()
  const { data: allDevices } = useDevices()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canCreate = usePermission('anlagen:create')
  const canDelete = usePermission('anlagen:delete')

  useDeviceStatus()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(EMPTY_FORM)
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [deleteTarget, setDeleteTarget] = useState<Anlage | null>(null)
  const [formError, setFormError] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const createMutation = useCreateAnlage()
  const deleteMutation = useDeleteAnlage()

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setAssign(EMPTY_ASSIGN)
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    setFormError('')
    try {
      const { latitude: latStr, longitude: lngStr, ...rest } = form
      const latitude = latStr ? parseFloat(latStr) : null
      const longitude = lngStr ? parseFloat(lngStr) : null
      const payload = { ...rest, latitude, longitude, ...assign }
      await createMutation.mutateAsync(payload)
      setDrawerOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  const handleGeocode = async () => {
    setGeocoding(true)
    try {
      const result = await geocodeAddress({
        street: form.street, zip: form.zip, city: form.city, country: form.country,
      })
      if (result) {
        setForm({
          ...form,
          latitude: result.latitude.toFixed(6),
          longitude: result.longitude.toFixed(6),
        })
      } else {
        setToast(t('anlagen.geocodeNotFound'))
      }
    } finally {
      setGeocoding(false)
    }
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  const deviceOptions = (allDevices ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.serialNumber})` }))
  const userOptions = (allUsers ?? []).map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName} (${u.email})` }))
  const groupOptions = (allGroups ?? []).map((g) => ({ id: g.id, label: g.name }))

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('anlagen.title', { count: anlagen?.length ?? 0 })}</Typography>
        <Box display="flex" gap={1}>
          <Button variant="outlined" startIcon={<MapIcon />} onClick={() => navigate('/anlagen/map')}>Karte</Button>
          {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('anlagen.add')}</Button>}
        </Box>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 140 }}>{t('common.status')}</TableCell>
              <TableCell>Projekt-Nr.</TableCell>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>Ort</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {anlagen?.length === 0 && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('anlagen.empty')}</Typography></TableCell></TableRow>

            )}
            {anlagen?.map((anlage) => {
              const deviceIdSet = new Set(anlage.anlageDevices.map((ad) => ad.device.id))
              const anlageDevices = (allDevices ?? []).filter((d) => deviceIdSet.has(d.id))
              const status = computeAnlageStatus(anlageDevices)
              return (
                <TableRow
                  key={anlage.id}
                  hover
                  onClick={() => navigate(`/anlagen/${anlage.id}`)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell><StatusChip status={status} /></TableCell>
                  <TableCell>{anlage.projectNumber ?? '—'}</TableCell>
                  <TableCell>{anlage.name}</TableCell>
                  <TableCell>{anlage.city ?? '—'}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {canDelete && <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(anlage)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: '100vw', sm: 420 }, maxWidth: '100vw', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h6" gutterBottom>{t('anlagen.newTitle')}</Typography>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tab label={t('common.basicData')} />
              <Tab label={t('common.assignments')} />
            </Tabs>
          </Box>

          <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

            {tab === 0 && (
              <Box display="flex" flexDirection="column" gap={2}>
                <TextField label="Projekt-Nr." value={form.projectNumber} onChange={(e) => setForm({ ...form, projectNumber: e.target.value })} fullWidth />
                <TextField label={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
                <TextField label={t('common.description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={2} />
                <Box>
                  <Typography variant="subtitle2" color="text.secondary" mb={0.5}>{t('anlagen.plantType')}</Typography>
                  <FormGroup row>
                    <FormControlLabel
                      control={<Checkbox checked={form.hasHeatPump} onChange={(e) => setForm({ ...form, hasHeatPump: e.target.checked })} />}
                      label={t('anlagen.plantTypeHeatPump')}
                    />
                    <FormControlLabel
                      control={<Checkbox checked={form.hasBoiler} onChange={(e) => setForm({ ...form, hasBoiler: e.target.checked })} />}
                      label={t('anlagen.plantTypeBoiler')}
                    />
                  </FormGroup>
                </Box>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" color="text.secondary">Adresse</Typography>
                <TextField label="Strasse" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} fullWidth />
                <Box display="flex" gap={2}>
                  <TextField label="PLZ" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} sx={{ width: 120 }} />
                  <TextField label="Ort" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} fullWidth />
                </Box>
                <TextField label="Land" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} fullWidth />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<MyLocationIcon />}
                  onClick={handleGeocode}
                  disabled={geocoding || (!form.street && !form.city && !form.zip)}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  {geocoding ? '…' : t('anlagen.geocode')}
                </Button>
                <Box display="flex" gap={2}>
                  <TextField label="Breitengrad" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} fullWidth placeholder="z.B. 47.3769" />
                  <TextField label="Längengrad" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} fullWidth placeholder="z.B. 8.5417" />
                </Box>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" color="text.secondary">Verantwortlicher</Typography>
                <TextField label="Name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} fullWidth />
                <TextField label="Telefon" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} fullWidth />
                <TextField label="Mobil" value={form.contactMobile} onChange={(e) => setForm({ ...form, contactMobile: e.target.value })} fullWidth />
                <TextField label="E-Mail" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} fullWidth />
                <Divider sx={{ my: 1 }} />
                <TextField label="Bemerkungen" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth multiline rows={3} />
              </Box>
            )}

            {tab === 1 && (
              <Box display="flex" flexDirection="column" gap={3}>
                <SearchableMultiSelect
                  label={t('nav.devices')}
                  options={deviceOptions}
                  selected={assign.deviceIds}
                  onChange={(ids) => setAssign({ ...assign, deviceIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.users')}
                  options={userOptions}
                  selected={assign.userIds}
                  onChange={(ids) => setAssign({ ...assign, userIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.groups')}
                  options={groupOptions}
                  selected={assign.groupIds}
                  onChange={(ids) => setAssign({ ...assign, groupIds: ids })}
                />
              </Box>
            )}
          </Box>

          <Box sx={{ p: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box display="flex" gap={1} justifyContent="flex-end">
              <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="contained" onClick={handleSave} disabled={createMutation.isPending}>{t('common.save')}</Button>
            </Box>
          </Box>
        </Box>
      </Drawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('anlagen.deleteTitle')}
        message={t('anlagen.deleteMessage', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => { if (deleteTarget) { await deleteMutation.mutateAsync(deleteTarget.id); setDeleteTarget(null) } }}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />

      <Snackbar
        open={!!toast}
        autoHideDuration={3500}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Box>
  )
}
