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
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import OpenInBrowserIcon from '@mui/icons-material/OpenInBrowser'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { useDevice, useCreateDeviceTodo, useUpdateDeviceTodo, useCreateDeviceLog, useDeviceCommand, useCreateLanDevice, useDeleteDevice } from '../features/devices/queries'
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
import { useSession } from '../context/SessionContext'
import { useTranslation } from 'react-i18next'

// ─── VPN-IP-Validierung ───────────────────────────────────────────────────────
// Schema: 10.A.0.B  (A: 11–255, B: 1–254)
// VPN-LAN wird daraus abgeleitet: 10.A.B.0/24

const VPN_IP_RE = /^10\.(1[1-9]|[2-9]\d|[1-2]\d{2}|255)\.0\.(25[0-4]|2[0-4]\d|1\d{2}|[1-9]\d|[1-9])$/

function validateVpnIp(ip: string): string | null {
  if (!ip) return 'Pflichtfeld'
  if (!VPN_IP_RE.test(ip)) return 'Format: 10.A.0.B  (A: 11–255, B: 1–254)  z.B. 10.11.0.2'
  return null
}

// LAN-Präfix: drei Oktette, z.B. 192.168.10
const LOCAL_PREFIX_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function validateLocalPrefix(prefix: string): string | null {
  if (!prefix) return 'Pflichtfeld'
  const m = LOCAL_PREFIX_RE.exec(prefix)
  if (!m) return 'Format: drei Oktette, z.B. 192.168.10'
  if ([m[1], m[2], m[3]].some((o) => parseInt(o) > 255)) return 'Oktette müssen 0–255 sein'
  return null
}

function vpnLanHint(vpnIp: string): string {
  const parts = vpnIp.split('.')
  if (parts.length === 4 && VPN_IP_RE.test(vpnIp))
    return `→ VPN-LAN: ${parts[0]}.${parts[1]}.${parts[3]}.0/24`
  return ''
}

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
  const { me } = useSession()
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
  const [visuOpen, setVisuOpen] = useState(false)
  const [visuTargetIp, setVisuTargetIp] = useState('')    // leer = Pi selbst; sonst LAN-IP z.B. 192.168.10.50
  const [visuTargetPort, setVisuTargetPort] = useState('')  // leer = visuPort aus Config
  const [pingResult, setPingResult] = useState<{ reachable: boolean; statusCode?: number; latencyMs?: number; error?: string; ip?: string; port?: number } | null>(null)
  const [pinging, setPinging] = useState(false)
  const [newVpnIp, setNewVpnIp] = useState('')
  const [newLocalPrefix, setNewLocalPrefix] = useState('192.168.10')
  const [newVisuPort, setNewVisuPort] = useState('80')
  const [newVisuIp, setNewVisuIp] = useState('')
  const [newWanIp, setNewWanIp] = useState('')
  const [editVpnIp, setEditVpnIp] = useState('')
  const [editLocalPrefix, setEditLocalPrefix] = useState('')
  const [editVisuPort, setEditVisuPort] = useState('80')
  const [editVisuIp, setEditVisuIp] = useState('')
  const [editWanIp, setEditWanIp] = useState('')

  // LAN-Geräte
  const createLanDevice = useCreateLanDevice(id!)
  const deleteLanDevice = useDeleteDevice()
  const [lanForm, setLanForm] = useState({ name: '', lanTargetIp: '', lanTargetPort: '80', notes: '' })
  const [lanFormOpen, setLanFormOpen] = useState(false)

  // Sync edit fields when vpnConfig loads
  useEffect(() => {
    if (vpnConfig) {
      setEditVpnIp(vpnConfig.vpnIp)
      setEditLocalPrefix(vpnConfig.localPrefix)
      setEditVisuPort(String(vpnConfig.visuPort ?? 80))
      setEditVisuIp(vpnConfig.visuIp ?? '')
      setEditWanIp(vpnConfig.wanIp ?? '')
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
                      error={!!newVpnIp && !!validateVpnIp(newVpnIp)}
                      helperText={
                        newVpnIp && validateVpnIp(newVpnIp)
                          ? validateVpnIp(newVpnIp)
                          : vpnLanHint(newVpnIp) || t('vpn.vpnIpHint')
                      }
                    />
                    <TextField
                      label={t('vpn.localPrefix')}
                      size="small"
                      value={newLocalPrefix}
                      onChange={(e) => setNewLocalPrefix(e.target.value)}
                      placeholder="192.168.10"
                      error={!!newLocalPrefix && !!validateLocalPrefix(newLocalPrefix)}
                      helperText={
                        newLocalPrefix && validateLocalPrefix(newLocalPrefix)
                          ? validateLocalPrefix(newLocalPrefix)
                          : t('vpn.localPrefixHint')
                      }
                    />
                    <TextField
                      label={t('vpn.visuPort')}
                      size="small"
                      type="number"
                      value={newVisuPort}
                      onChange={(e) => setNewVisuPort(e.target.value)}
                      placeholder="80"
                      inputProps={{ min: 1, max: 65535 }}
                      helperText={t('vpn.visuPortHint')}
                    />
                    <TextField
                      label={t('vpn.visuIp')}
                      size="small"
                      value={newVisuIp}
                      onChange={(e) => setNewVisuIp(e.target.value)}
                      placeholder="192.168.10.1"
                      helperText={t('vpn.visuIpHint')}
                    />
                    <TextField
                      label={t('vpn.wanIp')}
                      size="small"
                      value={newWanIp}
                      onChange={(e) => setNewWanIp(e.target.value)}
                      placeholder="192.168.1.100"
                      helperText={t('vpn.wanIpHint')}
                    />
                    <Box>
                      <Button
                        variant="contained"
                        disabled={!!validateVpnIp(newVpnIp) || !!validateLocalPrefix(newLocalPrefix) || enableVpn.isPending}
                        onClick={() => enableVpn.mutate(
                          { deviceId: id!, vpnIp: newVpnIp, localPrefix: newLocalPrefix, visuPort: parseInt(newVisuPort) || 80, visuIp: newVisuIp.trim() || null, wanIp: newWanIp.trim() || null },
                          { onSuccess: () => { setNewVpnIp(''); setNewLocalPrefix('192.168.10'); setNewVisuPort('80'); setNewVisuIp(''); setNewWanIp('') } }
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
                        error={!!editVpnIp && !!validateVpnIp(editVpnIp)}
                        helperText={
                          editVpnIp && validateVpnIp(editVpnIp)
                            ? validateVpnIp(editVpnIp)
                            : vpnLanHint(editVpnIp)
                        }
                      />
                      <TextField
                        label={t('vpn.localPrefix')}
                        size="small"
                        value={editLocalPrefix}
                        onChange={(e) => setEditLocalPrefix(e.target.value)}
                        error={!!editLocalPrefix && !!validateLocalPrefix(editLocalPrefix)}
                        helperText={
                          editLocalPrefix && validateLocalPrefix(editLocalPrefix)
                            ? validateLocalPrefix(editLocalPrefix)
                            : undefined
                        }
                      />
                      <TextField
                        label={t('vpn.visuPort')}
                        size="small"
                        type="number"
                        value={editVisuPort}
                        onChange={(e) => setEditVisuPort(e.target.value)}
                        inputProps={{ min: 1, max: 65535 }}
                        helperText={t('vpn.visuPortHint')}
                        sx={{ width: 120 }}
                      />
                      <TextField
                        label={t('vpn.visuIp')}
                        size="small"
                        value={editVisuIp}
                        onChange={(e) => setEditVisuIp(e.target.value)}
                        placeholder="192.168.10.1"
                        helperText={t('vpn.visuIpHint')}
                        sx={{ width: 200 }}
                      />
                      <TextField
                        label={t('vpn.wanIp')}
                        size="small"
                        value={editWanIp}
                        onChange={(e) => setEditWanIp(e.target.value)}
                        placeholder="192.168.1.100"
                        helperText={t('vpn.wanIpHint')}
                        sx={{ width: 200 }}
                      />
                      <Button
                        variant="outlined"
                        disabled={updateVpn.isPending || !!validateVpnIp(editVpnIp) || !!validateLocalPrefix(editLocalPrefix)}
                        onClick={() => updateVpn.mutate(
                          { deviceId: id!, vpnIp: editVpnIp, localPrefix: editLocalPrefix, visuPort: parseInt(editVisuPort) || 80, visuIp: editVisuIp.trim() || null, wanIp: editWanIp.trim() || null },
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
                          onClick={() => downloadBlob(`/vpn/devices/${id}/pi-config`, `vpn-device.conf`)}
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
                      {vpnConfig.visuIp ? ` · Pi-LAN: ${vpnConfig.visuIp}` : ''}
                      {vpnConfig.wanIp ? ` · WAN: ${vpnConfig.wanIp}` : ''}
                      {vpnConfig.piPublicKey ? ` · ${t('vpn.keyPresent')}` : ` · ${t('vpn.keyMissing')}`}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>
          )}
        </Box>

        {/* ── Visualisierung ─────────────────────────────────── */}
        {vpnConfig && device && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <OpenInBrowserIcon fontSize="small" /> Visualisierung
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>
                Pi-Visu über VPN-Proxy — der Server leitet die Anfrage durch den WireGuard-Tunnel weiter.
              </Typography>

              {/* Ziel-Gerät konfigurieren */}
              <Box display="flex" gap={2} mb={2} flexWrap="wrap" alignItems="flex-end">
                <TextField
                  label="Ziel-IP (optional)"
                  size="small"
                  value={visuTargetIp}
                  onChange={(e) => { setVisuTargetIp(e.target.value); setVisuOpen(false); setPingResult(null) }}
                  placeholder={`${vpnConfig.localPrefix}.1`}
                  helperText={visuTargetIp ? `→ Pi leitet via NETMAP weiter` : 'Leer = Pi selbst'}
                  sx={{ width: 200 }}
                />
                <TextField
                  label="Port (optional)"
                  size="small"
                  type="number"
                  value={visuTargetPort}
                  onChange={(e) => { setVisuTargetPort(e.target.value); setVisuOpen(false); setPingResult(null) }}
                  placeholder={String(vpnConfig.visuPort ?? 80)}
                  helperText={`Standard: ${vpnConfig.visuPort ?? 80}`}
                  inputProps={{ min: 1, max: 65535 }}
                  sx={{ width: 140 }}
                />
                <Box>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={pinging}
                    onClick={async () => {
                      setPinging(true)
                      setPingResult(null)
                      try {
                        const res = await import('../lib/api').then(m => m.apiGet<typeof pingResult>(`/vpn/devices/${id}/ping`))
                        setPingResult(res)
                      } catch {
                        setPingResult({ reachable: false, error: 'Anfrage fehlgeschlagen' })
                      } finally {
                        setPinging(false)
                      }
                    }}
                  >
                    {pinging ? 'Teste…' : 'Verbindung testen'}
                  </Button>
                  {pingResult && (
                    <Typography variant="caption" display="block" mt={0.5}
                      color={pingResult.reachable ? 'success.main' : 'error.main'}
                    >
                      {pingResult.reachable
                        ? `✓ Erreichbar – HTTP ${pingResult.statusCode} in ${pingResult.latencyMs}ms (${pingResult.ip}:${pingResult.port})`
                        : `✗ Nicht erreichbar (${pingResult.ip}:${pingResult.port}) – ${pingResult.error}`
                      }
                    </Typography>
                  )}
                </Box>
              </Box>

              {(() => {
                const token = localStorage.getItem('accessToken') ?? ''
                const params = new URLSearchParams({ access_token: token })
                if (me?.email) params.set('remoteUser', me.email)
                if (visuTargetIp.trim()) params.set('targetIp', visuTargetIp.trim())
                if (visuTargetPort.trim()) params.set('targetPort', visuTargetPort.trim())
                const visuUrl = `/api/vpn/devices/${id}/visu/?${params.toString()}`
                return (
                  <>
                    <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                      <Button
                        variant="contained"
                        startIcon={<OpenInBrowserIcon />}
                        onClick={() => setVisuOpen((v) => !v)}
                      >
                        {visuOpen ? 'Vorschau schliessen' : 'Vorschau anzeigen'}
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={<OpenInNewIcon />}
                        onClick={() => window.open(visuUrl, '_blank')}
                      >
                        In neuem Fenster öffnen
                      </Button>
                    </Box>
                    {visuOpen && (
                      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', height: 600 }}>
                        <iframe
                          key={visuUrl}
                          src={visuUrl}
                          style={{ width: '100%', height: '100%', border: 'none' }}
                          title={`Visualisierung – ${device.name}`}
                        />
                      </Box>
                    )}
                  </>
                )
              })()}
            </CardContent>
          </Card>
        )}

        {/* ── LAN-Geräte ────────────────────────────────────── */}
        {vpnConfig && device && (
          <Card sx={{ mt: 3 }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">LAN-Geräte</Typography>
                {canUpdate && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => setLanFormOpen((v) => !v)}
                  >
                    {lanFormOpen ? 'Abbrechen' : 'LAN-Gerät hinzufügen'}
                  </Button>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Geräte im lokalen Netzwerk des Pi (z.B. TECO, SPS), erreichbar via NETMAP über den VPN-Tunnel.
              </Typography>

              {lanFormOpen && (
                <Box display="flex" gap={1} mb={2} flexWrap="wrap" alignItems="flex-end">
                  <TextField
                    label="Name"
                    size="small"
                    value={lanForm.name}
                    onChange={(e) => setLanForm({ ...lanForm, name: e.target.value })}
                    sx={{ minWidth: 160 }}
                  />
                  <TextField
                    label="IP-Adresse"
                    size="small"
                    value={lanForm.lanTargetIp}
                    onChange={(e) => setLanForm({ ...lanForm, lanTargetIp: e.target.value })}
                    placeholder="192.168.10.50"
                    sx={{ minWidth: 140 }}
                  />
                  <TextField
                    label="Port"
                    size="small"
                    type="number"
                    value={lanForm.lanTargetPort}
                    onChange={(e) => setLanForm({ ...lanForm, lanTargetPort: e.target.value })}
                    sx={{ width: 80 }}
                  />
                  <TextField
                    label="Notizen"
                    size="small"
                    value={lanForm.notes}
                    onChange={(e) => setLanForm({ ...lanForm, notes: e.target.value })}
                    sx={{ minWidth: 140, flexGrow: 1 }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    disabled={!lanForm.name || !lanForm.lanTargetIp || createLanDevice.isPending}
                    onClick={async () => {
                      await createLanDevice.mutateAsync({
                        name: lanForm.name,
                        lanTargetIp: lanForm.lanTargetIp,
                        lanTargetPort: parseInt(lanForm.lanTargetPort) || 80,
                        notes: lanForm.notes || undefined,
                      })
                      setLanForm({ name: '', lanTargetIp: '', lanTargetPort: '80', notes: '' })
                      setLanFormOpen(false)
                    }}
                  >
                    Erstellen
                  </Button>
                </Box>
              )}

              {(!device.childDevices || device.childDevices.length === 0) && !lanFormOpen && (
                <Typography color="text.secondary">Keine LAN-Geräte konfiguriert.</Typography>
              )}

              {device.childDevices && device.childDevices.length > 0 && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>IP</TableCell>
                      <TableCell>Port</TableCell>
                      <TableCell align="right">Aktionen</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {device.childDevices.map((child) => {
                      const lanUrl = (() => {
                        const token = localStorage.getItem('accessToken') ?? ''
                        const lanIp = child.lanTargetIp ?? '0.0.0.0'
                        const lanPort = child.lanTargetPort ?? 80
                        return `/api/vpn/devices/${id}/lan/${lanIp}/${lanPort}/?access_token=${encodeURIComponent(token)}`
                      })()
                      return (
                        <TableRow key={child.id} hover>
                          <TableCell>{child.name}</TableCell>
                          <TableCell><code>{child.lanTargetIp}</code></TableCell>
                          <TableCell>{child.lanTargetPort ?? 80}</TableCell>
                          <TableCell align="right">
                            <Tooltip title="In neuem Tab öffnen">
                              <IconButton size="small" onClick={() => window.open(lanUrl, '_blank')}>
                                <OpenInNewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {canUpdate && (
                              <Tooltip title="Entfernen">
                                <IconButton size="small" color="error" onClick={() => deleteLanDevice.mutate(child.id)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

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
