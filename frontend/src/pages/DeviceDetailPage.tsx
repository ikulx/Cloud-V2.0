import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Chip from '@mui/material/Chip'
import Checkbox from '@mui/material/Checkbox'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import IconButton from '@mui/material/IconButton'
import Alert from '@mui/material/Alert'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import Tooltip from '@mui/material/Tooltip'
import Snackbar from '@mui/material/Snackbar'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import InstallDesktopIcon from '@mui/icons-material/InstallDesktop'
import DownloadIcon from '@mui/icons-material/Download'
import { useDevice, useCreateDeviceTodo, useUpdateDeviceTodo, useCreateDeviceLog, useDeviceCommand } from '../features/devices/queries'
import {
  useDeviceVpnConfig,
  useEnableDeviceVpn,
  useUpdateDeviceVpn,
  useDisableDeviceVpn,
  useDeployVpnToDevice,
} from '../features/vpn/queries'
import { apiFetch } from '../lib/api'
import { StatusChip } from '../components/StatusChip'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { usePermission } from '../hooks/usePermission'
import { useTranslation } from 'react-i18next'

// ─── Download-Helfer ──────────────────────────────────────────────────────────

function downloadBlob(url: string, filename: string) {
  apiFetch(url).then(async (res) => {
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  })
}

export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data: device, isLoading } = useDevice(id!)
  useDeviceStatus(id)

  const canUpdate = usePermission('devices:update')
  const canReadTodos = usePermission('todos:read')
  const canCreateTodo = usePermission('todos:create')
  const canUpdateTodo = usePermission('todos:update')
  const canReadLog = usePermission('logbook:read')
  const canCreateLog = usePermission('logbook:create')
  const canManageVpn = usePermission('vpn:manage')

  const [tab, setTab] = useState(0)
  const [todoTitle, setTodoTitle] = useState('')
  const [logMessage, setLogMessage] = useState('')

  const createTodo = useCreateDeviceTodo(id!)
  const updateTodo = useUpdateDeviceTodo(id!)
  const createLog = useCreateDeviceLog(id!)
  const sendCommand = useDeviceCommand(id!)

  // VPN
  const { data: vpnConfig } = useDeviceVpnConfig(id)
  const enableVpn  = useEnableDeviceVpn()
  const updateVpn  = useUpdateDeviceVpn()
  const disableVpn = useDisableDeviceVpn()
  const deployVpn  = useDeployVpnToDevice()
  const [vpnMsg, setVpnMsg] = useState<string | null>(null)
  const [newVpnIp, setNewVpnIp] = useState('')
  const [newLocalPrefix, setNewLocalPrefix] = useState('192.168.10')
  const [editVpnIp, setEditVpnIp] = useState('')
  const [editLocalPrefix, setEditLocalPrefix] = useState('')

  // Sync edit fields when vpnConfig loads
  useEffect(() => {
    if (vpnConfig) {
      setEditVpnIp(vpnConfig.vpnIp)
      setEditLocalPrefix(vpnConfig.localPrefix)
    }
  }, [vpnConfig])

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  if (!device) return <Typography>{t('detail.notFound')}</Typography>

  const lastSeen = device.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'

  const openTodos = device.todos?.filter((t) => t.status === 'OPEN').length ?? 0

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <IconButton onClick={() => navigate('/devices')}><ArrowBackIcon /></IconButton>
        <Box flexGrow={1}>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h5">{device.name}</Typography>
            <StatusChip mqttConnected={device.mqttConnected} isApproved={device.isApproved} size="medium" />
          </Box>
          <Typography variant="body2" color="text.secondary">SN: {device.serialNumber}</Typography>
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={t('detail.overview')} />
        {canReadTodos && <Tab label={t('todos.tab', { count: openTodos })} />}
        {canReadLog && <Tab label={t('logbook.tab')} />}
      </Tabs>

      {tab === 0 && (
        <>
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Details</Typography>
              {[
                { label: t('detail.ipAddress'), value: device.ipAddress ?? '—' },
                { label: t('detail.agentVersion'), value: device.agentVersion ?? '—' },
                { label: t('detail.firmware'), value: device.firmwareVersion ?? '—' },
                { label: t('detail.projectNumber'), value: device.projectNumber ?? '—' },
                { label: t('detail.schemaNumber'), value: device.schemaNumber ?? '—' },
                { label: t('detail.visuVersion'), value: device.visuVersion ?? '—' },
                { label: t('detail.lastSeen'), value: lastSeen },
              ].map(({ label, value }) => (
                <Box key={label} display="flex" justifyContent="space-between" py={0.5}>
                  <Typography variant="body2" color="text.secondary">{label}</Typography>
                  <Typography variant="body2">{value}</Typography>
                </Box>
              ))}
              {canUpdate && (
                <Box mt={2} pt={2} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>{t('devices.remoteCommands')}</Typography>
                  <Box display="flex" gap={1} flexWrap="wrap">
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!device.mqttConnected || sendCommand.isPending}
                      onClick={() => sendCommand.mutate('refresh')}
                    >
                      {t('devices.cmdRefresh')}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="warning"
                      disabled={!device.mqttConnected || sendCommand.isPending}
                      onClick={() => sendCommand.mutate('restart')}
                    >
                      {t('devices.cmdRestart')}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="info"
                      disabled={!device.mqttConnected || sendCommand.isPending}
                      onClick={() => sendCommand.mutate('update')}
                    >
                      {t('devices.cmdUpdate')}
                    </Button>
                  </Box>
                  {sendCommand.isSuccess && (
                    <Typography variant="caption" color="success.main" sx={{ mt: 1, display: 'block' }}>
                      {t('devices.cmdSent')}
                    </Typography>
                  )}
                  {sendCommand.isError && (
                    <Typography variant="caption" color="error.main" sx={{ mt: 1, display: 'block' }}>
                      {t('devices.cmdError')}
                    </Typography>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>{t('detail.assignments')}</Typography>
              <Typography variant="subtitle2" color="text.secondary">{t('nav.anlagen')}</Typography>
              <Box display="flex" gap={1} flexWrap="wrap" mb={1}>
                {device.anlageDevices.length === 0
                  ? <Typography variant="body2" color="text.secondary">—</Typography>
                  : device.anlageDevices.map((a) => <Chip key={a.anlage.id} label={a.anlage.name} size="small" />)}
              </Box>
              <Typography variant="subtitle2" color="text.secondary">{t('nav.groups')}</Typography>
              <Box display="flex" gap={1} flexWrap="wrap" mb={1}>
                {device.directGroups.length === 0
                  ? <Typography variant="body2" color="text.secondary">—</Typography>
                  : device.directGroups.map((g) => <Chip key={g.group.id} label={g.group.name} size="small" />)}
              </Box>
              {device.notes && <>
                <Typography variant="subtitle2" color="text.secondary">{t('devices.notes')}</Typography>
                <Typography variant="body2">{device.notes}</Typography>
              </>}
            </CardContent>
          </Card>

          {/* VPN-Karte */}
          {canManageVpn && (
            <Card sx={{ gridColumn: { xs: '1', md: '1 / -1' } }}>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <VpnKeyIcon color="primary" fontSize="small" />
                  <Typography variant="h6">{t('vpn.title')}</Typography>
                  {vpnConfig && <Chip label={t('vpn.enabled')} size="small" color="success" />}
                </Box>

                {!vpnConfig ? (
                  // VPN aktivieren
                  <Box display="flex" flexDirection="column" gap={2} maxWidth={400}>
                    <Typography variant="body2" color="text.secondary">{t('vpn.deviceNotEnabled')}</Typography>
                    <TextField
                      label={t('vpn.vpnIp')}
                      size="small"
                      value={newVpnIp}
                      onChange={(e) => setNewVpnIp(e.target.value)}
                      placeholder="10.11.0.2"
                      helperText={t('vpn.vpnIpHint')}
                    />
                    <TextField
                      label={t('vpn.localPrefix')}
                      size="small"
                      value={newLocalPrefix}
                      onChange={(e) => setNewLocalPrefix(e.target.value)}
                      placeholder="192.168.10"
                      helperText={t('vpn.localPrefixHint')}
                    />
                    <Box>
                      <Button
                        variant="contained"
                        disabled={!newVpnIp || !newLocalPrefix || enableVpn.isPending}
                        onClick={() => enableVpn.mutate(
                          { deviceId: id!, vpnIp: newVpnIp, localPrefix: newLocalPrefix },
                          { onSuccess: () => { setNewVpnIp(''); setNewLocalPrefix('192.168.10') } }
                        )}
                      >
                        {t('vpn.enableDevice')}
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  // VPN aktiv – Bearbeitung und Aktionen
                  <Box display="flex" flexDirection="column" gap={2}>
                    <Box display="flex" gap={2} flexWrap="wrap" alignItems="flex-start">
                      <TextField
                        label={t('vpn.vpnIp')}
                        size="small"
                        value={editVpnIp}
                        onChange={(e) => setEditVpnIp(e.target.value)}
                      />
                      <TextField
                        label={t('vpn.localPrefix')}
                        size="small"
                        value={editLocalPrefix}
                        onChange={(e) => setEditLocalPrefix(e.target.value)}
                      />
                      <Button
                        variant="outlined"
                        disabled={updateVpn.isPending}
                        onClick={() => updateVpn.mutate(
                          { deviceId: id!, vpnIp: editVpnIp, localPrefix: editLocalPrefix },
                          { onSuccess: () => setVpnMsg(t('vpn.saved')) }
                        )}
                      >
                        {t('common.save')}
                      </Button>
                    </Box>
                    <Box display="flex" gap={1} flexWrap="wrap">
                      <Tooltip title={t('vpn.downloadPiConfig')}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<DownloadIcon />}
                          onClick={() => downloadBlob(`/api/vpn/devices/${id}/pi-config`, `vpn-device.conf`)}
                        >
                          {t('vpn.downloadPiConfig')}
                        </Button>
                      </Tooltip>
                      <Tooltip title={t('vpn.deployToPi')}>
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            startIcon={<InstallDesktopIcon />}
                            disabled={!device.mqttConnected || !device.isApproved || deployVpn.isPending}
                            onClick={() => deployVpn.mutate(id!, {
                              onSuccess: () => setVpnMsg(t('vpn.deploySuccess', { count: 1 })),
                              onError:   () => setVpnMsg(t('vpn.deployError')),
                            })}
                          >
                            {t('vpn.installVpn')}
                          </Button>
                        </span>
                      </Tooltip>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => disableVpn.mutate(id!)}
                      >
                        {t('vpn.disableDevice')}
                      </Button>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      VPN-IP: <strong>{vpnConfig.vpnIp}</strong> · LAN: <strong>{vpnConfig.localPrefix}.0/24</strong>
                      {vpnConfig.piPublicKey ? ` · ${t('vpn.keyPresent')}` : ` · ${t('vpn.keyMissing')}`}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          )}
        </Box>

        <Snackbar
          open={!!vpnMsg}
          autoHideDuration={5000}
          onClose={() => setVpnMsg(null)}
          message={vpnMsg}
        />
        </>
      )}

      {canReadTodos && tab === (1) && (
        <Box>
          {canCreateTodo ? (
            <Box display="flex" gap={1} mb={2}>
              <TextField label={t('todos.newTodo')} value={todoTitle} onChange={(e) => setTodoTitle(e.target.value)} size="small" sx={{ flexGrow: 1 }} />
              <Button variant="contained" onClick={() => { if (todoTitle) { createTodo.mutate({ title: todoTitle }); setTodoTitle('') } }}>{t('todos.add')}</Button>
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>{t('detail.noPermissionTodos')}</Alert>
          )}
          {device.todos?.length === 0 && <Typography color="text.secondary">{t('todos.noTodos')}</Typography>}
          <List disablePadding>
            {device.todos?.map((todo) => (
              <ListItem key={todo.id} disablePadding sx={{ bgcolor: 'background.paper', mb: 0.5, borderRadius: 1, px: 1 }}>
                <Checkbox
                  checked={todo.status === 'DONE'}
                  onChange={() => canUpdateTodo && updateTodo.mutate({ todoId: todo.id, status: todo.status === 'DONE' ? 'OPEN' : 'DONE' })}
                  disabled={!canUpdateTodo}
                  size="small"
                />
                <ListItemText
                  primary={todo.title}
                  secondary={`${todo.createdBy.firstName} ${todo.createdBy.lastName} · ${new Date(todo.createdAt).toLocaleDateString()}`}
                  sx={{ textDecoration: todo.status === 'DONE' ? 'line-through' : 'none' }}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {canReadLog && tab === (canReadTodos ? 2 : 1) && (
        <Box>
          {canCreateLog ? (
            <Box display="flex" gap={1} mb={2}>
              <TextField label={t('logbook.newEntry')} value={logMessage} onChange={(e) => setLogMessage(e.target.value)} size="small" sx={{ flexGrow: 1 }} />
              <Button variant="contained" onClick={() => { if (logMessage) { createLog.mutate({ message: logMessage }); setLogMessage('') } }}>{t('logbook.add')}</Button>
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>{t('detail.noPermissionLogbook')}</Alert>
          )}
          {device.logEntries?.length === 0 && <Typography color="text.secondary">{t('logbook.noEntries')}</Typography>}
          <List disablePadding>
            {device.logEntries?.map((log) => (
              <ListItem key={log.id} disablePadding sx={{ bgcolor: 'background.paper', mb: 0.5, borderRadius: 1, px: 2, py: 1 }}>
                <ListItemText
                  primary={log.message}
                  secondary={`${log.createdBy.firstName} ${log.createdBy.lastName} · ${new Date(log.createdAt).toLocaleString()}`}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Box>
  )
}
