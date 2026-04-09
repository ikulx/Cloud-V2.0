import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import DownloadIcon from '@mui/icons-material/Download'
import { useSettings, useUpdateSettings } from '../features/settings/queries'
import { apiFetch } from '../lib/api'
import { useTranslation } from 'react-i18next'

export function SettingsPage() {
  const { t } = useTranslation()
  const { data: settings, isLoading } = useSettings()
  const updateSettings = useUpdateSettings()

  const [tab, setTab] = useState(0)
  const [form, setForm] = useState({ 'pi.serverUrl': '', 'pi.mqttHost': '', 'pi.mqttPort': '1883' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) {
      setForm({
        'pi.serverUrl': settings['pi.serverUrl'] ?? '',
        'pi.mqttHost': settings['pi.mqttHost'] ?? '',
        'pi.mqttPort': settings['pi.mqttPort'] ?? '1883',
      })
    }
  }, [settings])

  const handleSave = async () => {
    await updateSettings.mutateAsync(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleDownloadScript = async () => {
    const res = await apiFetch('/devices/setup-script')
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ycontrol-setup.py'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  return (
    <Box>
      <Typography variant="h5" mb={3}>{t('settings.title')}</Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={t('settings.tabPiSetup')} />
      </Tabs>

      {tab === 0 && (
        <Card sx={{ maxWidth: 560 }}>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 3 }}>
            <Typography variant="h6">{t('settings.piSetupTitle')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('settings.piSetupInfo')}
            </Typography>

            <TextField
              label={t('settings.serverUrl')}
              value={form['pi.serverUrl']}
              onChange={(e) => setForm((f) => ({ ...f, 'pi.serverUrl': e.target.value }))}
              helperText={t('settings.serverUrlHint')}
              fullWidth
            />
            <TextField
              label={t('settings.mqttHost')}
              value={form['pi.mqttHost']}
              onChange={(e) => setForm((f) => ({ ...f, 'pi.mqttHost': e.target.value }))}
              helperText={t('settings.mqttHostHint')}
              fullWidth
            />
            <TextField
              label={t('settings.mqttPort')}
              value={form['pi.mqttPort']}
              onChange={(e) => setForm((f) => ({ ...f, 'pi.mqttPort': e.target.value }))}
              type="number"
              fullWidth
            />

            {saved && <Alert severity="success">{t('settings.saved')}</Alert>}

            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={updateSettings.isPending}
              >
                {t('common.save')}
              </Button>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleDownloadScript}
              >
                {t('settings.downloadScript')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  )
}
