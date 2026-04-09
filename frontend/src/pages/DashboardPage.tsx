import Grid from '@mui/material/Grid'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import DevicesIcon from '@mui/icons-material/DevicesOther'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import HelpIcon from '@mui/icons-material/Help'
import AssignmentLateIcon from '@mui/icons-material/AssignmentLate'
import { useDevices } from '../features/devices/queries'
import { useAnlagen } from '../features/anlagen/queries'
import { StatusChip } from '../components/StatusChip'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useSession } from '../context/SessionContext'
import { useTranslation } from 'react-i18next'

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number | string; color?: string }) {
  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2}>
          <Box sx={{ color: color ?? 'primary.main' }}>{icon}</Box>
          <Box>
            <Typography variant="h4" fontWeight={700}>{value}</Typography>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const { me } = useSession()
  const { t } = useTranslation()
  const { data: devices, isLoading: loadingDevices } = useDevices()
  const { data: anlagen, isLoading: loadingAnlagen } = useAnlagen()

  useDeviceStatus()

  if (loadingDevices || loadingAnlagen) {
    return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  }

  const online = devices?.filter((d) => d.status === 'ONLINE').length ?? 0
  const offline = devices?.filter((d) => d.status === 'OFFLINE').length ?? 0
  const unknown = devices?.filter((d) => d.status === 'UNKNOWN').length ?? 0
  const withOpenTodos = devices?.filter((d) => (d._count?.todos ?? 0) > 0).length ?? 0

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        {t('dashboard.welcome', { name: me?.firstName })}
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={3}>
        {t('dashboard.subtitle')}
      </Typography>

      <Grid container spacing={3} mb={4}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<DevicesIcon fontSize="large" />} label={t('dashboard.totalDevices')} value={devices?.length ?? 0} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<CheckCircleIcon fontSize="large" />} label={t('dashboard.online')} value={online} color="success.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<ErrorIcon fontSize="large" />} label={t('dashboard.offline')} value={offline} color="error.main" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<HelpIcon fontSize="large" />} label={t('dashboard.unknown')} value={unknown} color="text.secondary" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<AssignmentLateIcon fontSize="large" />} label={t('dashboard.withOpenTodos')} value={withOpenTodos} color="warning.main" />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>{t('dashboard.deviceStatus')}</Typography>
              {devices?.length === 0 && <Typography color="text.secondary">{t('dashboard.noDevices')}</Typography>}
              {devices?.slice(0, 10).map((device) => (
                <Box key={device.id} display="flex" justifyContent="space-between" alignItems="center" py={0.5}>
                  <Typography variant="body2">{device.name}</Typography>
                  <StatusChip mqttConnected={device.mqttConnected} isApproved={device.isApproved} />
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>{t('nav.anlagen')} ({anlagen?.length ?? 0})</Typography>
              {anlagen?.length === 0 && <Typography color="text.secondary">{t('dashboard.noAnlagen')}</Typography>}
              {anlagen?.slice(0, 10).map((anlage) => (
                <Box key={anlage.id} display="flex" justifyContent="space-between" alignItems="center" py={0.5}>
                  <Typography variant="body2">{anlage.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('dashboard.deviceCount', { count: anlage._count?.anlageDevices ?? anlage.anlageDevices.length })}
                  </Typography>
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
