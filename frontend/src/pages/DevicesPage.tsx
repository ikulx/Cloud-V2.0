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
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import VisibilityIcon from '@mui/icons-material/Visibility'
import DownloadIcon from '@mui/icons-material/Download'
import { Link } from 'react-router-dom'
import { useDevices, useCreateDevice, useUpdateDevice, useDeleteDevice, useApproveDevice } from '../features/devices/queries'
import { useAnlagen } from '../features/anlagen/queries'
import { useUsers } from '../features/users/queries'
import { useGroups } from '../features/groups/queries'
import Chip from '@mui/material/Chip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SearchableMultiSelect } from '../components/SearchableMultiSelect'
import { usePermission } from '../hooks/usePermission'
import { apiFetch } from '../lib/api'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useTranslation } from 'react-i18next'
import type { Device } from '../types/model'

const EMPTY_FORM = { name: '', serialNumber: '', ipAddress: '', firmwareVersion: '', notes: '' }
const EMPTY_ASSIGN = { anlageIds: [] as string[], userIds: [] as string[], groupIds: [] as string[] }

export function DevicesPage() {
  const { data: devices, isLoading } = useDevices()
  const { data: allAnlagen } = useAnlagen()
  const { data: allUsers } = useUsers()
  const { data: allGroups } = useGroups()
  const { t } = useTranslation()
  const canUpdate = usePermission('devices:update')
  const canDelete = usePermission('devices:delete')

  useDeviceStatus()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const [editDevice, setEditDevice] = useState<Device | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null)
  const [formError, setFormError] = useState('')

  const createMutation = useCreateDevice()
  const updateMutation = useUpdateDevice(editDevice?.id ?? '')
  const deleteMutation = useDeleteDevice()
  const approveMutation = useApproveDevice()


  const openEdit = (device: Device) => {
    setEditDevice(device)
    setForm({
      name: device.name,
      serialNumber: device.serialNumber,
      ipAddress: device.ipAddress ?? '',
      firmwareVersion: device.firmwareVersion ?? '',
      notes: device.notes ?? '',
    })
    setAssign({
      anlageIds: device.anlageDevices.map((a) => a.anlage.id),
      userIds: device.directUsers.map((du) => du.user.id),
      groupIds: device.directGroups.map((dg) => dg.group.id),
    })
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    setFormError('')
    try {
      const payload = { ...form, ...assign }
      if (editDevice) {
        await updateMutation.mutateAsync(payload)
      } else {
        await createMutation.mutateAsync(payload)
      }
      setDrawerOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  const anlageOptions = (allAnlagen ?? []).map((a) => ({ id: a.id, label: a.name }))
  const userOptions = (allUsers ?? []).map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName} (${u.email})` }))
  const groupOptions = (allGroups ?? []).map((g) => ({ id: g.id, label: g.name }))

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('devices.title', { count: devices?.length ?? 0 })}</Typography>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={async () => {
          const res = await apiFetch('/devices/setup-script')
          if (!res.ok) return
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url; a.download = 'ycontrol-setup.py'; a.click()
          URL.revokeObjectURL(url)
        }}>
          {t('settings.downloadScript')}
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>{t('devices.serialNumber')}</TableCell>
              <TableCell>{t('common.status')}</TableCell>
              <TableCell>{t('devices.ipAddress')}</TableCell>
              <TableCell>{t('devices.firmware')}</TableCell>
              <TableCell>{t('devices.anlagen')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">{t('devices.empty')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {devices?.map((device) => (
              <TableRow key={device.id} hover>
                <TableCell>{device.name}</TableCell>
                <TableCell><code>{device.serialNumber}</code></TableCell>
                <TableCell>
                  <Box display="flex" flexDirection="column" gap={0.5}>
                    <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                      {/* MQTT */}
                      <Chip
                        label="MQTT"
                        size="small"
                        color={device.mqttConnected ? 'success' : 'error'}
                        variant={device.isApproved ? 'filled' : 'outlined'}
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                      {/* VPN */}
                      <Chip
                        label="VPN"
                        size="small"
                        color={device.vpnActive ? 'success' : device.vpnDevice ? 'warning' : 'default'}
                        variant={device.vpnDevice ? 'filled' : 'outlined'}
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                      {/* HTTP */}
                      <Chip
                        label="HTTP"
                        size="small"
                        color={device.httpActive ? 'success' : device.mqttConnected ? 'error' : 'default'}
                        variant={device.mqttConnected !== undefined ? 'filled' : 'outlined'}
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    </Box>
                    {canUpdate && !device.isApproved && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="success"
                        sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: '0.7rem', alignSelf: 'flex-start' }}
                        onClick={() => approveMutation.mutate({ id: device.id, isApproved: true })}
                        disabled={approveMutation.isPending}
                      >
                        {t('devices.register')}
                      </Button>
                    )}
                  </Box>
                </TableCell>
                <TableCell>{device.ipAddress ?? '—'}</TableCell>
                <TableCell>{device.firmwareVersion ?? '—'}</TableCell>
                <TableCell>
                  {device.anlageDevices.map((a) => a.anlage.name).join(', ') || '—'}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={t('common.details')}><IconButton component={Link} to={`/devices/${device.id}`} size="small"><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                  {canUpdate && <Tooltip title={t('common.edit')}><IconButton onClick={() => openEdit(device)} size="small"><EditIcon fontSize="small" /></IconButton></Tooltip>}
                  {canDelete && <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(device)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 420, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h6" gutterBottom>{editDevice ? t('devices.editTitle') : t('devices.newTitle')}</Typography>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tab label={t('common.basicData')} />
              <Tab label={t('common.assignments')} />
            </Tabs>
          </Box>

          <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

            {tab === 0 && (
              <Box display="flex" flexDirection="column" gap={2}>
                <TextField label={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
                <TextField label={t('devices.serialNumber')} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} fullWidth required disabled={!!editDevice} />
                <TextField label={t('devices.ipAddress')} value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} fullWidth />
                <TextField label={t('devices.firmwareVersion')} value={form.firmwareVersion} onChange={(e) => setForm({ ...form, firmwareVersion: e.target.value })} fullWidth />
                <TextField label={t('devices.notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth multiline rows={3} />
              </Box>
            )}

            {tab === 1 && (
              <Box display="flex" flexDirection="column" gap={3}>
                <SearchableMultiSelect
                  label={t('nav.anlagen')}
                  options={anlageOptions}
                  selected={assign.anlageIds}
                  onChange={(ids) => setAssign({ ...assign, anlageIds: ids })}
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
              <Button variant="contained" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>{t('common.save')}</Button>
            </Box>
          </Box>
        </Box>
      </Drawer>


      <ConfirmDialog
        open={!!deleteTarget}
        title={t('devices.deleteTitle')}
        message={t('devices.deleteMessage', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMutation.mutateAsync(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />
    </Box>
  )
}
