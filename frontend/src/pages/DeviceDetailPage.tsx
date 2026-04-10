import { useState } from 'react'
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
import { useDevice, useCreateDeviceTodo, useUpdateDeviceTodo, useCreateDeviceLog, useDeviceCommand } from '../features/devices/queries'
import { useDeviceVpnInfo, useDeployVpnToDevice } from '../features/vpn/queries'
import { StatusChip } from '../components/StatusChip'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { usePermission } from '../hooks/usePermission'
import { useTranslation } from 'react-i18next'

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

  const [tab, setTab] = useState(0)
  const [todoTitle, setTodoTitle] = useState('')
  const [logMessage, setLogMessage] = useState('')

  const createTodo = useCreateDeviceTodo(id!)
  const updateTodo = useUpdateDeviceTodo(id!)
  const createLog = useCreateDeviceLog(id!)
  const sendCommand = useDeviceCommand(id!)
  const { data: vpnInfos } = useDeviceVpnInfo(id)
  const deployVpn = useDeployVpnToDevice()
  const [vpnMsg, setVpnMsg] = useState<string | null>(null)
  const canManageVpn = usePermission('vpn:manage')

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
          {/* VPN-Karte – nur wenn Berechtigung und mind. eine Anlage VPN hat */}
          {canManageVpn && (
            <Card sx={{ gridColumn: { xs: '1', md: '1 / -1' } }}>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={1.5}>
                  <VpnKeyIcon color="primary" fontSize="small" />
                  <Typography variant="h6">{t('vpn.title')}</Typography>
                </Box>

                {!vpnInfos || vpnInfos.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {t('vpn.deviceNoVpn')}
                  </Typography>
                ) : (
                  <Box display="flex" flexDirection="column" gap={1.5}>
                    {vpnInfos.map((v) => (
                      <Box
                        key={v.anlageId}
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        flexWrap="wrap"
                        gap={1}
                        sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1 }}
                      >
                        <Box>
                          <Typography variant="body2" fontWeight={500}>{v.anlageName}</Typography>
                          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                            {v.subnetCidr} · Pi: {v.piIp} · LAN: {v.localPrefix}.0/24
                          </Typography>
                        </Box>
                        <Tooltip title={t('vpn.deployToPi')}>
                          <span>
                            <Button
                              size="small"
                              variant="outlined"
                              color="primary"
                              startIcon={<InstallDesktopIcon />}
                              disabled={!device.mqttConnected || !device.isApproved || deployVpn.isPending}
                              onClick={() => deployVpn.mutate(
                                { deviceId: id!, anlageId: v.anlageId },
                                {
                                  onSuccess: () => setVpnMsg(t('vpn.deploySuccess', { count: 1 })),
                                  onError:   () => setVpnMsg(t('vpn.deployError')),
                                }
                              )}
                            >
                              {t('vpn.installVpn')}
                            </Button>
                          </span>
                        </Tooltip>
                      </Box>
                    ))}
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
