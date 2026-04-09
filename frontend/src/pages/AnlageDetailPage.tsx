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
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useAnlage } from '../features/anlagen/queries'
import { StatusChip } from '../components/StatusChip'
import { useTranslation } from 'react-i18next'

export function AnlageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data: anlage, isLoading } = useAnlage(id!)

  const [tab, setTab] = useState(0)

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  if (!anlage) return <Typography>{t('detail.notFound')}</Typography>

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
        <Box display="flex" flexDirection="column" gap={1}>
          {anlage.anlageDevices.length === 0 && <Typography color="text.secondary">{t('devices.empty')}</Typography>}
          {anlage.anlageDevices.map((ad) => (
            <Card key={ad.device.id} variant="outlined">
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography>{ad.device.name}</Typography>
                  <StatusChip mqttConnected={false} isApproved={ad.device.isApproved} />
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
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
