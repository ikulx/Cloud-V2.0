import { useState, useEffect } from 'react'
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
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Snackbar from '@mui/material/Snackbar'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SettingsIcon from '@mui/icons-material/Settings'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import InfoIcon from '@mui/icons-material/Info'
import LinkIcon from '@mui/icons-material/Link'
import AssignmentIcon from '@mui/icons-material/Assignment'
import BookIcon from '@mui/icons-material/Book'
import HistoryIcon from '@mui/icons-material/History'
import { EntityActivityLog } from '../components/EntityActivityLog'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import PhoneIcon from '@mui/icons-material/Phone'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import EmailIcon from '@mui/icons-material/Email'
import EditIcon from '@mui/icons-material/Edit'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import { useAnlage, useUpdateAnlage, useCreateAnlageTodo, useUpdateAnlageTodo, useCreateAnlageLog } from '../features/anlagen/queries'
import { useDevices, useUpdateDevice } from '../features/devices/queries'
import { useSession } from '../context/SessionContext'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { usePermission } from '../hooks/usePermission'
import { geocodeAddress } from '../lib/geocode'
import { useTranslation } from 'react-i18next'
import type { Device } from '../types/model'

const EMPTY_INFO_FORM = {
  projectNumber: '', name: '', description: '',
  street: '', zip: '', city: '', country: 'Schweiz',
  latitude: '', longitude: '',
  hasHeatPump: false,
  hasBoiler: false,
  contactName: '', contactPhone: '', contactMobile: '', contactEmail: '',
  notes: '',
}

// Device-Name-Wrapper mit Update-Mutation (Hook pro Row erforderlich)
function DeviceNameCell({
  device, defaultName, canEdit,
}: { device: Device; defaultName: string; canEdit: boolean }) {
  const { t } = useTranslation()
  const updateDevice = useUpdateDevice(device.id)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(device.name || '')

  useEffect(() => { setValue(device.name || '') }, [device.name])

  const displayName = device.name?.trim() || defaultName

  if (editing) {
    const save = async () => {
      await updateDevice.mutateAsync({ name: value.trim() })
      setEditing(false)
    }
    return (
      <Box display="flex" alignItems="center" gap={0.5} onClick={(e) => e.stopPropagation()}>
        <TextField
          size="small"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={defaultName}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setValue(device.name || ''); setEditing(false) }
          }}
          sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
        />
        <IconButton size="small" onClick={save} disabled={updateDevice.isPending} color="primary">
          <CheckIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => { setValue(device.name || ''); setEditing(false) }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    )
  }

  return (
    <Box display="flex" alignItems="center" gap={0.5}>
      <Box sx={{ color: device.name?.trim() ? 'inherit' : 'text.secondary', fontStyle: device.name?.trim() ? 'normal' : 'italic' }}>
        {displayName}
      </Box>
      {canEdit && (
        <Tooltip title={t('devices.editName')}>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); setEditing(true) }}
            sx={{ opacity: 0.4, '&:hover': { opacity: 1 } }}
          >
            <EditIcon sx={{ fontSize: '0.9rem' }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

export function AnlageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { me } = useSession()
  const { data: anlage, isLoading } = useAnlage(id!)
  const { data: allDevices } = useDevices()
  const canUpdateAnlage = usePermission('anlagen:update')
  const canUpdateDevice = usePermission('devices:update')
  const canReadTodos = usePermission('todos:read')
  const canCreateTodo = usePermission('todos:create')
  const canUpdateTodo = usePermission('todos:update')
  const canReadLog = usePermission('logbook:read')
  const canCreateLog = usePermission('logbook:create')
  const canReadActivityLog = usePermission('activityLog:read')
  const updateAnlage = useUpdateAnlage(id ?? '')
  const createTodo = useCreateAnlageTodo(id ?? '')
  const updateTodo = useUpdateAnlageTodo(id ?? '')
  const createLog = useCreateAnlageLog(id ?? '')

  useDeviceStatus()

  const [tab, setTab] = useState(0)
  const [expandedVisuDeviceId, setExpandedVisuDeviceId] = useState<string | null>(null)
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoForm, setInfoForm] = useState(EMPTY_INFO_FORM)
  const [saveError, setSaveError] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [todoTitle, setTodoTitle] = useState('')
  const [logMessage, setLogMessage] = useState('')

  // Validierung für Edit-Modus (gleiche Pflichtfelder wie im Wizard)
  const basicsValid = infoForm.projectNumber.trim().length > 0
                      && infoForm.name.trim().length > 0
                      && (infoForm.hasHeatPump || infoForm.hasBoiler)
  const addressValid = infoForm.street.trim().length > 0
                       && infoForm.zip.trim().length > 0
                       && infoForm.city.trim().length > 0

  useEffect(() => {
    if (anlage) {
      setInfoForm({
        projectNumber: anlage.projectNumber ?? '',
        name: anlage.name,
        description: anlage.description ?? '',
        street: anlage.street ?? '',
        zip: anlage.zip ?? '',
        city: anlage.city ?? '',
        country: anlage.country ?? 'Schweiz',
        latitude: anlage.latitude != null ? String(anlage.latitude) : '',
        longitude: anlage.longitude != null ? String(anlage.longitude) : '',
        hasHeatPump: anlage.hasHeatPump ?? false,
        hasBoiler: anlage.hasBoiler ?? false,
        contactName: anlage.contactName ?? '',
        contactPhone: anlage.contactPhone ?? '',
        contactMobile: anlage.contactMobile ?? '',
        contactEmail: anlage.contactEmail ?? '',
        notes: anlage.notes ?? '',
      })
    }
  }, [anlage])

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

  const handleSaveInfo = async () => {
    setSaveError('')
    if (!basicsValid || !addressValid) {
      setShowErrors(true)
      return
    }
    try {
      const { latitude: latStr, longitude: lngStr, ...rest } = infoForm
      const latitude = latStr ? parseFloat(latStr) : null
      const longitude = lngStr ? parseFloat(lngStr) : null
      await updateAnlage.mutateAsync({ ...rest, latitude, longitude })
      setShowErrors(false)
      setEditingInfo(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  const handleGeocode = async () => {
    setGeocoding(true)
    try {
      const result = await geocodeAddress({
        street: infoForm.street,
        zip: infoForm.zip,
        city: infoForm.city,
        country: infoForm.country,
      })
      if (result) {
        setInfoForm({
          ...infoForm,
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

  const handleCancelInfo = () => {
    if (anlage) {
      setInfoForm({
        projectNumber: anlage.projectNumber ?? '',
        name: anlage.name,
        description: anlage.description ?? '',
        street: anlage.street ?? '',
        zip: anlage.zip ?? '',
        city: anlage.city ?? '',
        country: anlage.country ?? 'Schweiz',
        latitude: anlage.latitude != null ? String(anlage.latitude) : '',
        longitude: anlage.longitude != null ? String(anlage.longitude) : '',
        hasHeatPump: anlage.hasHeatPump ?? false,
        hasBoiler: anlage.hasBoiler ?? false,
        contactName: anlage.contactName ?? '',
        contactPhone: anlage.contactPhone ?? '',
        contactMobile: anlage.contactMobile ?? '',
        contactEmail: anlage.contactEmail ?? '',
        notes: anlage.notes ?? '',
      })
    }
    setSaveError('')
    setShowErrors(false)
    setEditingInfo(false)
  }

  const plantTypeLabel = (hp: boolean, b: boolean): string => {
    const parts: string[] = []
    if (hp) parts.push(t('anlagen.plantTypeHeatPump'))
    if (b)  parts.push(t('anlagen.plantTypeBoiler'))
    return parts.length ? parts.join(' + ') : '—'
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  if (!anlage) return <Typography>{t('detail.notFound')}</Typography>

  // Vollständige Device-Objekte aus allDevices holen (mit vpnDevice, Status, etc.)
  const deviceIds = new Set(anlage.anlageDevices.map((ad) => ad.device.id))
  const anlageDevices = (allDevices ?? []).filter((d) => deviceIds.has(d.id))
  const defaultDeviceName = t('devices.defaultName')

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
        {canReadTodos && (
          <Tab
            icon={<AssignmentIcon fontSize="small" />}
            iconPosition="start"
            label={t('todos.tab', { count: anlage.todos?.filter((tt) => tt.status === 'OPEN').length ?? 0 })}
          />
        )}
        {canReadLog && (
          <Tab
            icon={<BookIcon fontSize="small" />}
            iconPosition="start"
            label={t('logbook.tab')}
          />
        )}
        {canReadActivityLog && (
          <Tab
            icon={<HistoryIcon fontSize="small" />}
            iconPosition="start"
            label={t('activityLog.tab', 'Aktivität')}
          />
        )}
      </Tabs>

      {/* TAB 0: INFOS */}
      {tab === 0 && (
        <>
          {/* Edit-Aktionsleiste */}
          <Box display="flex" justifyContent="flex-end" alignItems="center" gap={1} mb={2}>
            {editingInfo ? (
              <>
                <Button onClick={handleCancelInfo} disabled={updateAnlage.isPending}>
                  {t('common.cancel')}
                </Button>
                <Button variant="contained" onClick={handleSaveInfo} disabled={updateAnlage.isPending}>
                  {t('common.save')}
                </Button>
              </>
            ) : (
              canUpdateAnlage && (
                <Tooltip title={t('common.edit')}>
                  <IconButton onClick={() => { setShowErrors(false); setEditingInfo(true) }}>
                    <EditIcon />
                  </IconButton>
                </Tooltip>
              )
            )}
          </Box>

          {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={3}>
            {/* Linke Spalte: Stammdaten + Adresse */}
            <Stack spacing={3}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Stammdaten</Typography>
                  {editingInfo ? (
                    <Stack spacing={2}>
                      <TextField
                        label="Projekt-Nr. *"
                        size="small"
                        value={infoForm.projectNumber}
                        onChange={(e) => setInfoForm({ ...infoForm, projectNumber: e.target.value })}
                        fullWidth
                        required
                        error={showErrors && !infoForm.projectNumber.trim()}
                        helperText={showErrors && !infoForm.projectNumber.trim() ? t('common.fieldRequired') : ''}
                      />
                      <TextField
                        label={t('common.name') + ' *'}
                        size="small"
                        value={infoForm.name}
                        onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
                        fullWidth
                        required
                        error={showErrors && !infoForm.name.trim()}
                        helperText={showErrors && !infoForm.name.trim() ? t('common.fieldRequired') : ''}
                      />
                      <TextField label={t('common.description')} size="small" value={infoForm.description} onChange={(e) => setInfoForm({ ...infoForm, description: e.target.value })} fullWidth multiline rows={2} />
                      <Box>
                        <Typography variant="caption" color={showErrors && !infoForm.hasHeatPump && !infoForm.hasBoiler ? 'error' : 'text.secondary'}>
                          {t('anlagen.plantType')} *
                        </Typography>
                        <FormGroup row>
                          <FormControlLabel
                            control={<Checkbox size="small" checked={infoForm.hasHeatPump} onChange={(e) => setInfoForm({ ...infoForm, hasHeatPump: e.target.checked })} />}
                            label={t('anlagen.plantTypeHeatPump')}
                          />
                          <FormControlLabel
                            control={<Checkbox size="small" checked={infoForm.hasBoiler} onChange={(e) => setInfoForm({ ...infoForm, hasBoiler: e.target.checked })} />}
                            label={t('anlagen.plantTypeBoiler')}
                          />
                        </FormGroup>
                        {showErrors && !infoForm.hasHeatPump && !infoForm.hasBoiler && (
                          <Typography variant="caption" color="error">{t('anlagen.plantTypeRequired')}</Typography>
                        )}
                      </Box>
                    </Stack>
                  ) : (
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
                        <Typography variant="caption" color="text.secondary">{t('anlagen.plantType')}</Typography>
                        <Typography variant="body1">{plantTypeLabel(anlage.hasHeatPump, anlage.hasBoiler)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Anzahl Geräte</Typography>
                        <Typography variant="body1">{anlageDevices.length}</Typography>
                      </Box>
                    </Stack>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Adresse</Typography>
                  {editingInfo ? (
                    <Stack spacing={2}>
                      <TextField
                        label="Strasse *"
                        size="small"
                        value={infoForm.street}
                        onChange={(e) => setInfoForm({ ...infoForm, street: e.target.value })}
                        fullWidth
                        required
                        error={showErrors && !infoForm.street.trim()}
                        helperText={showErrors && !infoForm.street.trim() ? t('common.fieldRequired') : ''}
                      />
                      <Box display="flex" gap={2}>
                        <TextField
                          label="PLZ *"
                          size="small"
                          value={infoForm.zip}
                          onChange={(e) => setInfoForm({ ...infoForm, zip: e.target.value })}
                          sx={{ width: 120 }}
                          required
                          error={showErrors && !infoForm.zip.trim()}
                        />
                        <TextField
                          label="Ort *"
                          size="small"
                          value={infoForm.city}
                          onChange={(e) => setInfoForm({ ...infoForm, city: e.target.value })}
                          fullWidth
                          required
                          error={showErrors && !infoForm.city.trim()}
                        />
                      </Box>
                      <TextField label="Land" size="small" value={infoForm.country} onChange={(e) => setInfoForm({ ...infoForm, country: e.target.value })} fullWidth />
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<MyLocationIcon />}
                        onClick={handleGeocode}
                        disabled={geocoding || (!infoForm.street && !infoForm.city && !infoForm.zip)}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {geocoding ? '…' : t('anlagen.geocode')}
                      </Button>
                      <Box display="flex" gap={2}>
                        <TextField label="Breitengrad" size="small" value={infoForm.latitude} onChange={(e) => setInfoForm({ ...infoForm, latitude: e.target.value })} fullWidth placeholder="z.B. 47.3769" />
                        <TextField label="Längengrad" size="small" value={infoForm.longitude} onChange={(e) => setInfoForm({ ...infoForm, longitude: e.target.value })} fullWidth placeholder="z.B. 8.5417" />
                      </Box>
                    </Stack>
                  ) : (
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
                  )}
                </CardContent>
              </Card>

              {(editingInfo || anlage.notes) && (
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>Bemerkungen</Typography>
                    {editingInfo ? (
                      <TextField size="small" value={infoForm.notes} onChange={(e) => setInfoForm({ ...infoForm, notes: e.target.value })} fullWidth multiline rows={3} />
                    ) : (
                      <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{anlage.notes}</Typography>
                    )}
                  </CardContent>
                </Card>
              )}
            </Stack>

            {/* Rechte Spalte: Verantwortlicher + Zuweisungen */}
            <Stack spacing={3}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>Verantwortlicher</Typography>
                  {editingInfo ? (
                    <Stack spacing={2}>
                      <TextField label="Name" size="small" value={infoForm.contactName} onChange={(e) => setInfoForm({ ...infoForm, contactName: e.target.value })} fullWidth />
                      <TextField label="Telefon" size="small" value={infoForm.contactPhone} onChange={(e) => setInfoForm({ ...infoForm, contactPhone: e.target.value })} fullWidth />
                      <TextField label="Mobil" size="small" value={infoForm.contactMobile} onChange={(e) => setInfoForm({ ...infoForm, contactMobile: e.target.value })} fullWidth />
                      <TextField label="E-Mail" size="small" value={infoForm.contactEmail} onChange={(e) => setInfoForm({ ...infoForm, contactEmail: e.target.value })} fullWidth />
                    </Stack>
                  ) : anlage.contactName ? (
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
        </>
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
                          <DeviceNameCell device={device} defaultName={defaultDeviceName} canEdit={canUpdateDevice} />
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
                                    title={`Visualisierung – ${device.name || defaultDeviceName}`}
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

      {/* TAB 2: TODOS */}
      {canReadTodos && tab === 2 && (
        <Box>
          {canCreateTodo ? (
            <Box display="flex" gap={1} mb={2}>
              <TextField
                label={t('todos.newTodo')}
                value={todoTitle}
                onChange={(e) => setTodoTitle(e.target.value)}
                size="small"
                sx={{ flexGrow: 1 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && todoTitle.trim()) {
                    createTodo.mutate({ title: todoTitle.trim() })
                    setTodoTitle('')
                  }
                }}
              />
              <Button
                variant="contained"
                disabled={!todoTitle.trim() || createTodo.isPending}
                onClick={() => {
                  if (todoTitle.trim()) {
                    createTodo.mutate({ title: todoTitle.trim() })
                    setTodoTitle('')
                  }
                }}
              >
                {t('todos.add')}
              </Button>
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>{t('detail.noPermissionTodos')}</Alert>
          )}
          {(!anlage.todos || anlage.todos.length === 0) && (
            <Typography color="text.secondary">{t('todos.noTodos')}</Typography>
          )}
          <List disablePadding>
            {anlage.todos?.map((todo) => (
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

      {/* TAB 3: LOGBUCH */}
      {canReadLog && tab === (canReadTodos ? 3 : 2) && (
        <Box>
          {canCreateLog ? (
            <Box display="flex" gap={1} mb={2}>
              <TextField
                label={t('logbook.newEntry')}
                value={logMessage}
                onChange={(e) => setLogMessage(e.target.value)}
                size="small"
                sx={{ flexGrow: 1 }}
                multiline
                maxRows={4}
              />
              <Button
                variant="contained"
                disabled={!logMessage.trim() || createLog.isPending}
                onClick={() => {
                  if (logMessage.trim()) {
                    createLog.mutate({ message: logMessage.trim() })
                    setLogMessage('')
                  }
                }}
              >
                {t('logbook.add')}
              </Button>
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>{t('detail.noPermissionLogbook')}</Alert>
          )}
          {(!anlage.logEntries || anlage.logEntries.length === 0) && (
            <Typography color="text.secondary">{t('logbook.noEntries')}</Typography>
          )}
          <List disablePadding>
            {anlage.logEntries?.map((log) => (
              <ListItem key={log.id} disablePadding sx={{ bgcolor: 'background.paper', mb: 0.5, borderRadius: 1, px: 2, py: 1 }}>
                <ListItemText
                  primary={<Typography sx={{ whiteSpace: 'pre-wrap' }}>{log.message}</Typography>}
                  secondary={`${log.createdBy.firstName} ${log.createdBy.lastName} · ${new Date(log.createdAt).toLocaleString()}`}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}

      {/* TAB 4: AKTIVITÄTSLOG */}
      {canReadActivityLog && tab === ((canReadTodos ? 1 : 0) + (canReadLog ? 1 : 0) + 2) && id && (
        <EntityActivityLog entityId={id} />
      )}

      <Snackbar
        open={!!toast}
        autoHideDuration={3500}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Box>
  )
}
