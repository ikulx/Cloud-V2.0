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
import Collapse from '@mui/material/Collapse'
import Chip from '@mui/material/Chip'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import SettingsIcon from '@mui/icons-material/Settings'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { Link } from 'react-router-dom'
import { useAnlagen, useCreateAnlage, useUpdateAnlage, useDeleteAnlage } from '../features/anlagen/queries'
import { useUsers } from '../features/users/queries'
import { useGroups } from '../features/groups/queries'
import { useDevices } from '../features/devices/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SearchableMultiSelect } from '../components/SearchableMultiSelect'
import { usePermission } from '../hooks/usePermission'
import { useSession } from '../context/SessionContext'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useTranslation } from 'react-i18next'
import type { Anlage, Device } from '../types/model'

const EMPTY_FORM = { name: '', description: '', location: '' }
const EMPTY_ASSIGN = { deviceIds: [] as string[], userIds: [] as string[], groupIds: [] as string[] }

export function AnlagenPage() {
  const { data: anlagen, isLoading } = useAnlagen()
  const { data: allUsers } = useUsers()
  const { data: allGroups } = useGroups()
  const { data: allDevices } = useDevices()
  const { t } = useTranslation()
  const { me } = useSession()
  const canCreate = usePermission('anlagen:create')
  const canUpdate = usePermission('anlagen:update')
  const canDelete = usePermission('anlagen:delete')

  useDeviceStatus()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const [editAnlage, setEditAnlage] = useState<Anlage | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [deleteTarget, setDeleteTarget] = useState<Anlage | null>(null)
  const [formError, setFormError] = useState('')
  const [expandedAnlageId, setExpandedAnlageId] = useState<string | null>(null)
  const [expandedVisuDeviceId, setExpandedVisuDeviceId] = useState<string | null>(null)

  const createMutation = useCreateAnlage()
  const updateMutation = useUpdateAnlage(editAnlage?.id ?? '')
  const deleteMutation = useDeleteAnlage()

  const openCreate = () => {
    setEditAnlage(null)
    setForm(EMPTY_FORM)
    setAssign(EMPTY_ASSIGN)
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const openEdit = (a: Anlage) => {
    setEditAnlage(a)
    setForm({ name: a.name, description: a.description ?? '', location: a.location ?? '' })
    setAssign({
      deviceIds: a.anlageDevices.map((ad) => ad.device.id),
      userIds: a.directUsers.map((du) => du.user.id),
      groupIds: a.groupAnlagen.map((ga) => ga.group.id),
    })
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    setFormError('')
    try {
      const payload = { ...form, ...assign }
      if (editAnlage) await updateMutation.mutateAsync(payload)
      else await createMutation.mutateAsync(payload)
      setDrawerOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  const buildVisuUrl = (deviceId: string) => {
    const token = localStorage.getItem('accessToken') ?? ''
    const params = new URLSearchParams({ access_token: token })
    if (me?.email) params.set('remoteUser', me.email)
    return `/api/vpn/devices/${deviceId}/visu/?${params.toString()}`
  }

  const handleAnlageClick = (anlage: Anlage) => {
    if (anlage.anlageDevices.length === 0) return
    setExpandedAnlageId((prev) => {
      if (prev === anlage.id) return null
      setExpandedVisuDeviceId(null)
      return anlage.id
    })
  }

  const handleDeviceClick = (device: Device) => {
    if (!device.vpnDevice) return
    setExpandedVisuDeviceId((prev) => (prev === device.id ? null : device.id))
  }

  // Vollständige Device-Objekte für eine Anlage aus allDevices holen
  const getAnlageDevices = (anlage: Anlage): Device[] => {
    if (!allDevices) return []
    const deviceIds = new Set(anlage.anlageDevices.map((ad) => ad.device.id))
    return allDevices.filter((d) => deviceIds.has(d.id))
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  const deviceOptions = (allDevices ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.serialNumber})` }))
  const userOptions = (allUsers ?? []).map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName} (${u.email})` }))
  const groupOptions = (allGroups ?? []).map((g) => ({ id: g.id, label: g.name }))

  const anlageColCount = 5

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('anlagen.title', { count: anlagen?.length ?? 0 })}</Typography>
        {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('anlagen.add')}</Button>}
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>{t('common.description')}</TableCell>
              <TableCell>{t('anlagen.location')}</TableCell>
              <TableCell>{t('nav.devices')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {anlagen?.length === 0 && (
              <TableRow><TableCell colSpan={anlageColCount} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('anlagen.empty')}</Typography></TableCell></TableRow>
            )}
            {anlagen?.map((anlage) => {
              const isExpanded = expandedAnlageId === anlage.id
              const hasDevices = anlage.anlageDevices.length > 0
              const anlageDevices = isExpanded ? getAnlageDevices(anlage) : []

              return (
                <>
                  <TableRow
                    key={anlage.id}
                    hover
                    onClick={() => handleAnlageClick(anlage)}
                    sx={{
                      cursor: hasDevices ? 'pointer' : 'default',
                      '& > td': isExpanded ? { borderBottom: 'none' } : undefined,
                    }}
                  >
                    <TableCell>
                      <Box display="flex" alignItems="center" gap={0.5}>
                        {hasDevices && (
                          isExpanded
                            ? <KeyboardArrowUpIcon fontSize="small" color="action" />
                            : <KeyboardArrowDownIcon fontSize="small" color="action" />
                        )}
                        {anlage.name}
                      </Box>
                    </TableCell>
                    <TableCell>{anlage.description ?? '—'}</TableCell>
                    <TableCell>{anlage.location ?? '—'}</TableCell>
                    <TableCell>{anlage._count?.anlageDevices ?? anlage.anlageDevices.length}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {canUpdate && <Tooltip title={t('common.edit')}><IconButton onClick={() => openEdit(anlage)} size="small"><EditIcon fontSize="small" /></IconButton></Tooltip>}
                      {canDelete && <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(anlage)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                    </TableCell>
                  </TableRow>

                  {/* Geräteliste: aufklappbar unter der Anlagezeile */}
                  {hasDevices && (
                    <TableRow key={`${anlage.id}-devices`}>
                      <TableCell colSpan={anlageColCount} sx={{ p: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Box sx={{ px: 2, pb: 2 }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>{t('common.name')}</TableCell>
                                  <TableCell>{t('devices.serialNumber')}</TableCell>
                                  <TableCell>{t('common.status')}</TableCell>
                                  <TableCell align="right">{t('common.actions')}</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {anlageDevices.map((device) => {
                                  const hasVpn = !!device.vpnDevice
                                  const isVisuOpen = expandedVisuDeviceId === device.id

                                  return (
                                    <>
                                      <TableRow
                                        key={device.id}
                                        hover
                                        onClick={() => handleDeviceClick(device)}
                                        sx={{
                                          cursor: hasVpn ? 'pointer' : 'default',
                                          '& > td': isVisuOpen ? { borderBottom: 'none' } : undefined,
                                        }}
                                      >
                                        <TableCell>
                                          <Box display="flex" alignItems="center" gap={0.5}>
                                            {hasVpn && (
                                              isVisuOpen
                                                ? <KeyboardArrowUpIcon fontSize="small" color="action" />
                                                : <KeyboardArrowDownIcon fontSize="small" color="action" />
                                            )}
                                            {device.name}
                                          </Box>
                                        </TableCell>
                                        <TableCell><code>{device.serialNumber}</code></TableCell>
                                        <TableCell>
                                          <Box display="flex" alignItems="center" gap={0.5}>
                                            <Chip
                                              label="MQTT"
                                              size="small"
                                              color={device.isApproved ? (device.mqttConnected ? 'success' : 'error') : 'default'}
                                              variant={device.isApproved ? 'filled' : 'outlined'}
                                              sx={{ fontSize: '0.65rem', height: 20 }}
                                            />
                                            <Chip
                                              label="VPN"
                                              size="small"
                                              color={device.vpnDevice ? (device.vpnActive ? 'success' : 'error') : 'default'}
                                              variant={device.vpnDevice ? 'filled' : 'outlined'}
                                              sx={{ fontSize: '0.65rem', height: 20 }}
                                            />
                                            <Chip
                                              label="HTTP"
                                              size="small"
                                              color={device.vpnDevice ? (device.httpActive ? 'success' : 'error') : 'default'}
                                              variant={device.vpnDevice ? 'filled' : 'outlined'}
                                              sx={{ fontSize: '0.65rem', height: 20 }}
                                            />
                                          </Box>
                                        </TableCell>
                                        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                          <Tooltip title={t('common.details')}><IconButton component={Link} to={`/devices/${device.id}`} size="small"><SettingsIcon fontSize="small" /></IconButton></Tooltip>
                                        </TableCell>
                                      </TableRow>

                                      {/* Visu-Vorschau */}
                                      {hasVpn && (
                                        <TableRow key={`${device.id}-visu`}>
                                          <TableCell colSpan={4} sx={{ p: 0, borderBottom: isVisuOpen ? undefined : 'none' }}>
                                            <Collapse in={isVisuOpen} timeout="auto" unmountOnExit>
                                              <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
                                                <Box display="flex" justifyContent="flex-end" mb={1}>
                                                  <Button
                                                    variant="outlined"
                                                    size="small"
                                                    startIcon={<OpenInNewIcon />}
                                                    onClick={() => window.open(buildVisuUrl(device.id), '_blank')}
                                                  >
                                                    {t('devices.openNewTab', 'In neuem Tab öffnen')}
                                                  </Button>
                                                </Box>
                                                <Box
                                                  sx={{
                                                    border: '1px solid',
                                                    borderColor: 'divider',
                                                    borderRadius: 1,
                                                    overflow: 'hidden',
                                                    height: 600,
                                                    bgcolor: 'background.paper',
                                                  }}
                                                >
                                                  <iframe
                                                    src={buildVisuUrl(device.id)}
                                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                                    title={`Visualisierung – ${device.name}`}
                                                  />
                                                </Box>
                                              </Box>
                                            </Collapse>
                                          </TableCell>
                                        </TableRow>
                                      )}
                                    </>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 420, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h6" gutterBottom>{editAnlage ? t('anlagen.editTitle') : t('anlagen.newTitle')}</Typography>
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
                <TextField label={t('common.description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={2} />
                <TextField label={t('anlagen.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} fullWidth />
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
              <Button variant="contained" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>{t('common.save')}</Button>
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
    </Box>
  )
}
