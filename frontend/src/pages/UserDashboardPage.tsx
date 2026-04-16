import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardActions from '@mui/material/CardActions'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import Divider from '@mui/material/Divider'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import BusinessIcon from '@mui/icons-material/Business'
import { useAnlagen } from '../features/anlagen/queries'
import { useDevices } from '../features/devices/queries'
import { useSession } from '../context/SessionContext'
import type { Device } from '../types/model'

function buildLanUrl(parentId: string, ip: string, port: number): string {
  const token = localStorage.getItem('accessToken') ?? ''
  return `/api/vpn/devices/${parentId}/lan/${ip}/${port}/?access_token=${encodeURIComponent(token)}`
}

interface VisuTarget {
  id: string
  name: string
  url: string
  online: boolean
}

function collectVisus(device: Device): VisuTarget[] {
  const targets: VisuTarget[] = []
  const online = device.status === 'ONLINE' && (device.vpnActive ?? false)

  // Parent-Gerät selbst: falls es einen httpActive-Dienst hat → Direktlink via LAN-Proxy (Loopback)
  if (device.httpActive && device.vpnDevice?.vpnIp) {
    targets.push({
      id: device.id,
      name: device.name,
      url: buildLanUrl(device.id, '127.0.0.1', 80),
      online,
    })
  }

  // LAN-Child-Devices
  for (const child of device.childDevices ?? []) {
    if (!child.lanTargetIp) continue
    targets.push({
      id: child.id,
      name: child.name,
      url: buildLanUrl(device.id, child.lanTargetIp, child.lanTargetPort ?? 80),
      online,
    })
  }

  return targets
}

export function UserDashboardPage() {
  const { me } = useSession()
  const anlagenQuery = useAnlagen()
  const devicesQuery = useDevices()

  const anlagen = anlagenQuery.data ?? []
  const devices = devicesQuery.data ?? []

  // Devices nach Anlage gruppieren
  const devicesByAnlage = new Map<string, Device[]>()
  for (const device of devices) {
    for (const ad of device.anlageDevices ?? []) {
      const list = devicesByAnlage.get(ad.anlage.id) ?? []
      list.push(device)
      devicesByAnlage.set(ad.anlage.id, list)
    }
  }

  const isLoading = anlagenQuery.isLoading || devicesQuery.isLoading

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight={700}>
          Willkommen, {me?.firstName}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Wählen Sie eine Anlage, um die zugehörige Visualisierung zu öffnen.
        </Typography>
      </Box>

      {isLoading && <Typography color="text.secondary">Lade Anlagen...</Typography>}

      {!isLoading && anlagen.length === 0 && (
        <Card>
          <CardContent>
            <Typography color="text.secondary">
              Es sind keine Anlagen für Sie freigeschaltet. Bitte kontaktieren Sie Ihren Verwalter.
            </Typography>
          </CardContent>
        </Card>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
          },
        }}
      >
        {anlagen.map((anlage) => {
          const anlageDevices = devicesByAnlage.get(anlage.id) ?? []
          const visus = anlageDevices.flatMap(collectVisus)

          return (
            <Card key={anlage.id} sx={{ display: 'flex', flexDirection: 'column' }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                  <BusinessIcon color="primary" />
                  <Typography variant="h6" fontWeight={600}>
                    {anlage.name}
                  </Typography>
                </Stack>
                {anlage.city && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {[anlage.zip, anlage.city].filter(Boolean).join(' ')}
                  </Typography>
                )}
                {anlage.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {anlage.description}
                  </Typography>
                )}

                <Divider sx={{ my: 2 }} />

                {visus.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    Keine Visualisierungen verfügbar.
                  </Typography>
                ) : (
                  <Stack spacing={1}>
                    {visus.map((visu) => (
                      <Box
                        key={visu.id}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1,
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <Chip
                            size="small"
                            label={visu.online ? 'ONLINE' : 'OFFLINE'}
                            color={visu.online ? 'success' : 'default'}
                            sx={{ fontWeight: 600 }}
                          />
                          <Typography variant="body2" noWrap title={visu.name}>
                            {visu.name}
                          </Typography>
                        </Stack>
                        <Button
                          variant="contained"
                          size="small"
                          disabled={!visu.online}
                          startIcon={<OpenInNewIcon />}
                          onClick={() => window.open(visu.url, '_blank')}
                        >
                          Öffnen
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                )}
              </CardContent>
              {visus.length > 0 && (
                <CardActions sx={{ px: 2, pb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    {visus.length} Visualisierung{visus.length !== 1 ? 'en' : ''}
                  </Typography>
                </CardActions>
              )}
            </Card>
          )
        })}
      </Box>
    </Box>
  )
}
