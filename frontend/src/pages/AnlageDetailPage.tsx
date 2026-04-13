import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Collapse from '@mui/material/Collapse'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SettingsIcon from '@mui/icons-material/Settings'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { useAnlage } from '../features/anlagen/queries'
import { useDevices } from '../features/devices/queries'
import { useSession } from '../context/SessionContext'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useTranslation } from 'react-i18next'
import type { Device } from '../types/model'

export function AnlageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { me } = useSession()
  const { data: anlage, isLoading } = useAnlage(id!)
  const { data: allDevices } = useDevices()

  useDeviceStatus()

  const [tab, setTab] = useState(0)
  const [expandedVisuDeviceId, setExpandedVisuDeviceId] = useState<string | null>(null)

  const buildVisuUrl = (deviceId: string) => {
    const token = localStorage.getItem('accessToken') ?? ''
    const params = new URLSearchParams({ access_token: token })
    if (me?.email) params.set('remoteUser', me.email)
    return `/api/vpn/devices/${deviceId}/visu/?${params.toString()}`
  }

  const handleDeviceClick = (device: Device) => {
    if (!device.vpnDevice) return
    setExpandedVisuDeviceId((prev) => (prev === device.id ? null : device.id))
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  if (!anlage) return <Typography>{t('detail.notFound')}</Typography>

  // Vollständige Device-Objekte aus allDevices holen (mit vpnDevice, Status, etc.)
  const deviceIds = new Set(anlage.anlageDevices.map((ad) => ad.device.id))
  const anlageDevices = (allDevices ?? []).filter((d) => deviceIds.has(d.id))

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <IconButton onClick={() => navigate('/anlagen')}><ArrowBackIcon /></IconButton>
        <Box>
          <Typography variant="h5">{anlage.name}</Typography>
          {anlage.location && <Typography variant="body2" color="text.secondary">{anlage.location}</Typography>}
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label={`${t('nav.devices')} (${anlage.anlageDevices.length})`} />
        <Tab label={t('detail.assignments')} />
      </Tabs>

      {tab === 0 && (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('common.name')}</TableCell>
                <TableCell>{t('devices.serialNumber')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell>{t('devices.ipAddress')}</TableCell>
                <TableCell>{t('devices.firmware')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {anlageDevices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">{t('devices.empty')}</Typography>
                  </TableCell>
                </TableRow>
              )}
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
                      <TableCell>{device.ipAddress ?? '—'}</TableCell>
                      <TableCell>{device.firmwareVersion ?? '—'}</TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title={t('common.details')}><IconButton component={Link} to={`/devices/${device.id}`} size="small"><SettingsIcon fontSize="small" /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>

                    {/* Visu-Vorschau */}
                    {hasVpn && (
                      <TableRow key={`${device.id}-visu`}>
                        <TableCell colSpan={6} sx={{ p: 0, borderBottom: isVisuOpen ? undefined : 'none' }}>
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
        </TableContainer>
      )}

      {tab === 1 && (
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>{t('users.title', { count: anlage.directUsers.length })}</Typography>
              {anlage.directUsers.length === 0
                ? <Typography color="text.secondary">—</Typography>
                : anlage.directUsers.map((du) => <Chip key={du.user.id} label={`${du.user.firstName} ${du.user.lastName}`} size="small" sx={{ mr: 0.5, mb: 0.5 }} />)}
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>{t('groups.title', { count: anlage.groupAnlagen.length })}</Typography>
              {anlage.groupAnlagen.length === 0
                ? <Typography color="text.secondary">—</Typography>
                : anlage.groupAnlagen.map((ga) => <Chip key={ga.group.id} label={ga.group.name} size="small" sx={{ mr: 0.5, mb: 0.5 }} />)}
            </CardContent>
          </Card>
        </Box>
      )}
    </Box>
  )
}
