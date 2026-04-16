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
import Stack from '@mui/material/Stack'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SettingsIcon from '@mui/icons-material/Settings'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import InfoIcon from '@mui/icons-material/Info'
import LinkIcon from '@mui/icons-material/Link'
import PhoneIcon from '@mui/icons-material/Phone'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import EmailIcon from '@mui/icons-material/Email'
import Divider from '@mui/material/Divider'
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
          <Box display="flex" alignItems="baseline" gap={1}>
            {anlage.projectNumber && <Typography variant="body2" color="text.secondary">{anlage.projectNumber} —</Typography>}
            <Typography variant="h5">{anlage.name}</Typography>
          </Box>
          {anlage.city && <Typography variant="body2" color="text.secondary">{[anlage.zip, anlage.city].filter(Boolean).join(' ')}{anlage.country ? `, ${anlage.country}` : ''}</Typography>}
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<InfoIcon fontSize="small" />} iconPosition="start" label="Infos" />
        <Tab icon={<LinkIcon fontSize="small" />} iconPosition="start" label={`Fernzugriff (${anlageDevices.length})`} />
      </Tabs>

      {/* TAB 0: INFOS */}
      {tab === 0 && (
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={3}>
          {/* Linke Spalte: Stammdaten + Adresse */}
          <Stack spacing={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Stammdaten</Typography>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Projekt-Nr.</Typography>
                    <Typography variant="body1">{anlage.projectNumber ?? '—'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('common.name')}</Typography>
                    <Typography variant="body1">{anlage.name}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">{t('common.description')}</Typography>
                    <Typography variant="body1">{anlage.description ?? '—'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Anzahl Geräte</Typography>
                    <Typography variant="body1">{anlageDevices.length}</Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Adresse</Typography>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Strasse</Typography>
                    <Typography variant="body1">{anlage.street ?? '—'}</Typography>
                  </Box>
                  <Box display="flex" gap={4}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">PLZ</Typography>
                      <Typography variant="body1">{anlage.zip ?? '—'}</Typography>
                    </Box>
                    <Box flex={1}>
                      <Typography variant="caption" color="text.secondary">Ort</Typography>
                      <Typography variant="body1">{anlage.city ?? '—'}</Typography>
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Land</Typography>
                    <Typography variant="body1">{anlage.country ?? '—'}</Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>

            {anlage.notes && (
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Bemerkungen</Typography>
                  <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{anlage.notes}</Typography>
                </CardContent>
              </Card>
            )}
          </Stack>

          {/* Rechte Spalte: Verantwortlicher + Zuweisungen */}
          <Stack spacing={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>Verantwortlicher</Typography>
                {anlage.contactName ? (
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">Name</Typography>
                      <Typography variant="body1">{anlage.contactName}</Typography>
                    </Box>
                    {anlage.contactPhone && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <PhoneIcon fontSize="small" color="action" />
                        <Box>
                          <Typography variant="caption" color="text.secondary">Telefon</Typography>
                          <Typography variant="body1">{anlage.contactPhone}</Typography>
                        </Box>
                      </Box>
                    )}
                    {anlage.contactMobile && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <PhoneAndroidIcon fontSize="small" color="action" />
                        <Box>
                          <Typography variant="caption" color="text.secondary">Mobil</Typography>
                          <Typography variant="body1">{anlage.contactMobile}</Typography>
                        </Box>
                      </Box>
                    )}
                    {anlage.contactEmail && (
                      <Box display="flex" alignItems="center" gap={1}>
                        <EmailIcon fontSize="small" color="action" />
                        <Box>
                          <Typography variant="caption" color="text.secondary">E-Mail</Typography>
                          <Typography variant="body1">{anlage.contactEmail}</Typography>
                        </Box>
                      </Box>
                    )}
                  </Stack>
                ) : (
                  <Typography color="text.secondary">—</Typography>
                )}
              </CardContent>
            </Card>

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
          </Stack>
        </Box>
      )}

      {/* TAB 1: FERNZUGRIFF */}
      {tab === 1 && (
        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('common.name')}</TableCell>
                <TableCell>{t('devices.serialNumber')}</TableCell>
                <TableCell>{t('common.status')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {anlageDevices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
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
                              {device.visuVersion ? (
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
                              ) : (
                                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                                  {t('devices.noVisuPreview', 'Keine Visu-Vorschau verfügbar – bitte im neuen Tab öffnen.')}
                                </Typography>
                              )}
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
    </Box>
  )
}
