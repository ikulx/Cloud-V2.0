import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Tooltip from '@mui/material/Tooltip'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import RouterIcon from '@mui/icons-material/Router'
import PeopleIcon from '@mui/icons-material/People'
import SettingsIcon from '@mui/icons-material/Settings'
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew'
import { useTranslation } from 'react-i18next'
import {
  useVpnSettings, useUpdateVpnSettings,
  useVpnAnlagen, useEnableVpnAnlage, useDisableVpnAnlage,
  useVpnPeers, useAddVpnPeer, useDeleteVpnPeer,
} from '../features/vpn/queries'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../lib/api'
import { apiFetch } from '../lib/api'
import { ConfirmDialog } from '../components/ConfirmDialog'

// ─── Anlage-Selector (für VPN-Aktivierung) ───────────────────────────────────

interface AnlageOption { id: string; name: string; location?: string | null }

function useAllAnlagen() {
  return useQuery({
    queryKey: ['anlagen', 'all'],
    queryFn: () => apiGet<AnlageOption[]>('/anlagen'),
  })
}

// ─── Download-Helfer ─────────────────────────────────────────────────────────

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

// ─── Haupt-Seite ──────────────────────────────────────────────────────────────

export function VpnPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState(0)

  return (
    <Box>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <VpnKeyIcon color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5">{t('vpn.title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('vpn.subtitle')}</Typography>
        </Box>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab icon={<SettingsIcon />} iconPosition="start" label={t('vpn.tabSettings')} />
        <Tab icon={<RouterIcon />}   iconPosition="start" label={t('vpn.tabAnlagen')} />
        <Tab icon={<PeopleIcon />}   iconPosition="start" label={t('vpn.tabPeers')} />
      </Tabs>

      {tab === 0 && <SettingsTab />}
      {tab === 1 && <AnlagenTab />}
      {tab === 2 && <PeersTab />}
    </Box>
  )
}

// ─── Tab 1: Server-Einstellungen ──────────────────────────────────────────────

function SettingsTab() {
  const { t } = useTranslation()
  const { data, isLoading } = useVpnSettings()
  const update = useUpdateVpnSettings()

  const [pubKey,   setPubKey]   = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [port,     setPort]     = useState('51820')
  const [saved,    setSaved]    = useState(false)

  // Felder einmalig befüllen sobald Daten geladen
  const [initialized, setInitialized] = useState(false)
  if (data && !initialized) {
    setInitialized(true)
    setPubKey(data.serverPublicKey)
    setEndpoint(data.serverEndpoint)
    setPort(String(data.serverPort || 51820))
  }

  const handleSave = () => {
    update.mutate(
      { serverPublicKey: pubKey, serverEndpoint: endpoint, serverPort: parseInt(port, 10) },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 3000) } }
    )
  }

  if (isLoading) return <CircularProgress />

  return (
    <Box maxWidth={640} display="flex" flexDirection="column" gap={3}>
      <Alert severity="info">
        {t('vpn.settingsInfo')}
      </Alert>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>{t('vpn.serverConfig')}</Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('vpn.serverConfigDesc')}
          </Typography>

          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t('vpn.serverPublicKey')}
              value={pubKey}
              onChange={(e) => setPubKey(e.target.value)}
              placeholder="z.B. ABC123...="
              helperText={t('vpn.serverPublicKeyHint')}
              fullWidth
              size="small"
            />
            <TextField
              label={t('vpn.serverEndpoint')}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="vpn.example.com:51820"
              helperText={t('vpn.serverEndpointHint')}
              fullWidth
              size="small"
            />
            <TextField
              label={t('vpn.serverPort')}
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputProps={{ min: 1, max: 65535 }}
              fullWidth
              size="small"
            />
          </Box>

          <Box display="flex" gap={2} mt={2} alignItems="center">
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={update.isPending}
            >
              {update.isPending ? t('common.loading') : t('common.save')}
            </Button>
            {saved && <Typography color="success.main" variant="body2">{t('vpn.saved')}</Typography>}
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>{t('vpn.serverSetup')}</Typography>
          <Typography variant="body2" color="text.secondary" mb={1}>
            {t('vpn.serverSetupDesc')}
          </Typography>
          <Box component="pre" sx={{ bgcolor: 'grey.900', color: 'grey.100', p: 2, borderRadius: 1, fontSize: 12, overflow: 'auto' }}>
{`# 1. WireGuard installieren
apt install wireguard

# 2. Server-Schlüsselpaar generieren
wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
cat /etc/wireguard/server.key   # → PrivateKey
cat /etc/wireguard/server.pub   # → PublicKey (hier eintragen)

# 3. IP-Weiterleitung aktivieren
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf && sysctl -p

# 4. wg0.conf herunterladen und anwenden
wg-quick up wg0
systemctl enable wg-quick@wg0`}
          </Box>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            sx={{ mt: 2 }}
            onClick={() => downloadBlob('/api/vpn/server-config', 'wg0.conf')}
          >
            {t('vpn.downloadServerConfig')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>{t('vpn.ipSchema')}</Typography>
          <Box component="pre" sx={{ bgcolor: 'grey.900', color: 'grey.100', p: 2, borderRadius: 1, fontSize: 12, overflow: 'auto' }}>
{`Zone A — Management (10.0.0.0/16)
  10.0.x.y     Techniker-PCs (VPN-Peers)
  10.1.0.1     Cloud-Server (wg0)

Zone B — Anlagen (10.11.0.0/8)
  10.11.1.0/24 → Anlage 1   (NETMAP ↔ 192.168.x.0/24)
  10.11.2.0/24 → Anlage 2
  ...
  10.12.244.0/24 → Anlage 500
  max. 62 720 Anlagen`}
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}

// ─── Tab 2: Anlagen-VPN ───────────────────────────────────────────────────────

function AnlagenTab() {
  const { t } = useTranslation()
  const { data: vpnAnlagen, isLoading } = useVpnAnlagen()
  const { data: allAnlagen }            = useAllAnlagen()
  const enableMut  = useEnableVpnAnlage()
  const disableMut = useDisableVpnAnlage()

  const [enableDialog, setEnableDialog] = useState(false)
  const [selectedAnlageId, setSelectedAnlageId] = useState('')
  const [localPrefix, setLocalPrefix]   = useState('192.168.10')
  const [confirmDisable, setConfirmDisable] = useState<string | null>(null)

  const enabledIds = new Set(vpnAnlagen?.map((v) => v.anlageId))
  const available  = allAnlagen?.filter((a) => !enabledIds.has(a.id)) ?? []

  const handleEnable = () => {
    if (!selectedAnlageId) return
    enableMut.mutate(
      { anlageId: selectedAnlageId, localPrefix },
      { onSuccess: () => { setEnableDialog(false); setSelectedAnlageId(''); setLocalPrefix('192.168.10') } }
    )
  }

  if (isLoading) return <CircularProgress />

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">{t('vpn.anlagenTitle', { count: vpnAnlagen?.length ?? 0 })}</Typography>
        <Button variant="contained" startIcon={<PowerSettingsNewIcon />} onClick={() => setEnableDialog(true)}>
          {t('vpn.enableAnlage')}
        </Button>
      </Box>

      {(!vpnAnlagen || vpnAnlagen.length === 0) ? (
        <Alert severity="info">{t('vpn.noAnlagen')}</Alert>
      ) : (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.name')}</TableCell>
                <TableCell>{t('vpn.subnet')}</TableCell>
                <TableCell>{t('vpn.piIp')}</TableCell>
                <TableCell>{t('vpn.localPrefix')}</TableCell>
                <TableCell>{t('vpn.piKey')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {vpnAnlagen.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{a.anlageName}</Typography>
                    {a.anlageOrt && <Typography variant="caption" color="text.secondary">{a.anlageOrt}</Typography>}
                  </TableCell>
                  <TableCell><Chip label={a.subnetCidr} size="small" color="primary" variant="outlined" /></TableCell>
                  <TableCell><Typography variant="body2" fontFamily="monospace">{a.piIp}</Typography></TableCell>
                  <TableCell><Typography variant="body2" fontFamily="monospace">{a.localPrefix}.0/24</Typography></TableCell>
                  <TableCell>
                    {a.piPublicKey
                      ? <Chip label={t('vpn.keyPresent')} size="small" color="success" />
                      : <Chip label={t('vpn.keyMissing')} size="small" color="warning" />}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('vpn.downloadPiConfig')}>
                      <IconButton size="small" onClick={() => downloadBlob(`/api/vpn/anlagen/${a.anlageId}/pi-config`, `vpn-${a.anlageName}.conf`)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('vpn.disableAnlage')}>
                      <IconButton size="small" color="error" onClick={() => setConfirmDisable(a.anlageId)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Dialog: Anlage aktivieren */}
      <Dialog open={enableDialog} onClose={() => setEnableDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('vpn.enableAnlageTitle')}</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              select
              label={t('vpn.selectAnlage')}
              value={selectedAnlageId}
              onChange={(e) => setSelectedAnlageId(e.target.value)}
              SelectProps={{ native: true }}
              fullWidth
              size="small"
            >
              <option value="">— {t('vpn.selectAnlage')} —</option>
              {available.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.location ? ` (${a.location})` : ''}</option>
              ))}
            </TextField>
            <TextField
              label={t('vpn.localPrefix')}
              value={localPrefix}
              onChange={(e) => setLocalPrefix(e.target.value)}
              helperText={t('vpn.localPrefixHint')}
              placeholder="192.168.10"
              fullWidth
              size="small"
            />
            <Alert severity="info" sx={{ fontSize: 12 }}>
              {t('vpn.enableAnlageInfo')}
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnableDialog(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleEnable} disabled={!selectedAnlageId || enableMut.isPending}>
            {t('vpn.activate')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deaktivieren bestätigen */}
      <ConfirmDialog
        open={!!confirmDisable}
        title={t('vpn.disableAnlageTitle')}
        message={t('vpn.disableAnlageMessage')}
        onConfirm={() => {
          if (confirmDisable) disableMut.mutate(confirmDisable)
          setConfirmDisable(null)
        }}
        onClose={() => setConfirmDisable(null)}
      />
    </Box>
  )
}

// ─── Tab 3: Techniker-Peers ───────────────────────────────────────────────────

function PeersTab() {
  const { t } = useTranslation()
  const { data: peers, isLoading } = useVpnPeers()
  const addMut    = useAddVpnPeer()
  const deleteMut = useDeleteVpnPeer()

  const [addDialog, setAddDialog]   = useState(false)
  const [peerName, setPeerName]     = useState('')
  const [publicKey, setPublicKey]   = useState('')
  const [keyError, setKeyError]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const validateKey = (k: string) => {
    // WG public key: 44 Zeichen Base64
    if (!/^[A-Za-z0-9+/]{43}=$/u.test(k)) {
      setKeyError(t('vpn.invalidKey'))
    } else {
      setKeyError('')
    }
  }

  const handleAdd = () => {
    if (!peerName || !publicKey || keyError) return
    addMut.mutate(
      { name: peerName, publicKey },
      { onSuccess: () => { setAddDialog(false); setPeerName(''); setPublicKey(''); setKeyError('') } }
    )
  }

  if (isLoading) return <CircularProgress />

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">{t('vpn.peersTitle', { count: peers?.length ?? 0 })}</Typography>
        <Button variant="contained" onClick={() => setAddDialog(true)}>
          {t('vpn.addPeer')}
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        {t('vpn.peersInfo')}
      </Alert>

      {(!peers || peers.length === 0) ? (
        <Alert severity="info">{t('vpn.noPeers')}</Alert>
      ) : (
        <Card>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.name')}</TableCell>
                <TableCell>{t('vpn.assignedIp')}</TableCell>
                <TableCell>{t('vpn.publicKey')}</TableCell>
                <TableCell>{t('vpn.linkedUser')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {peers.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{p.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={p.ip} size="small" color="secondary" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace" fontSize={11}>
                      {p.publicKey.slice(0, 20)}…
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {p.user
                      ? <Typography variant="body2">{p.user.firstName} {p.user.lastName}</Typography>
                      : <Typography variant="body2" color="text.secondary">—</Typography>}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={t('vpn.downloadPeerConfig')}>
                      <IconButton size="small" onClick={() => downloadBlob(`/api/vpn/peers/${p.id}/config`, `vpn-${p.name}.conf`)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('common.delete')}>
                      <IconButton size="small" color="error" onClick={() => setConfirmDelete(p.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Dialog: Peer hinzufügen */}
      <Dialog open={addDialog} onClose={() => setAddDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('vpn.addPeerTitle')}</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              label={t('vpn.peerName')}
              value={peerName}
              onChange={(e) => setPeerName(e.target.value)}
              placeholder={t('vpn.peerNamePlaceholder')}
              fullWidth
              size="small"
            />
            <TextField
              label={t('vpn.publicKey')}
              value={publicKey}
              onChange={(e) => { setPublicKey(e.target.value); validateKey(e.target.value) }}
              helperText={keyError || t('vpn.publicKeyHint')}
              error={!!keyError}
              placeholder="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
              fullWidth
              size="small"
            />
            <Box component="pre" sx={{ bgcolor: 'grey.100', p: 1.5, borderRadius: 1, fontSize: 11, color: 'text.secondary' }}>
{`# Schlüsselpaar auf dem Techniker-PC generieren:
wg genkey | tee tech.key | wg pubkey > tech.pub
cat tech.pub   # → diesen Wert hier eintragen`}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDialog(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleAdd}
            disabled={!peerName || !publicKey || !!keyError || addMut.isPending}
          >
            {t('vpn.addPeer')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Peer löschen bestätigen */}
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('vpn.deletePeerTitle')}
        message={t('vpn.deletePeerMessage')}
        onConfirm={() => {
          if (confirmDelete) deleteMut.mutate(confirmDelete)
          setConfirmDelete(null)
        }}
        onClose={() => setConfirmDelete(null)}
      />
    </Box>
  )
}
