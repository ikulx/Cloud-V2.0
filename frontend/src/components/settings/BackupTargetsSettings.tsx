import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import { useTranslation } from 'react-i18next'
import { useSettings, useUpdateSettings } from '../../features/settings/queries'
import { apiPost } from '../../lib/api'

type InfoForm = {
  'backup.infomaniak.enabled': string
  'backup.infomaniak.endpoint': string
  'backup.infomaniak.region': string
  'backup.infomaniak.bucket': string
  'backup.infomaniak.accessKey': string
  'backup.infomaniak.secretKey': string
}

export function BackupTargetsSettings() {
  const { t } = useTranslation()
  const { data: settings } = useSettings(true)
  const updateSettings = useUpdateSettings()

  const [info, setInfo] = useState<InfoForm>({
    'backup.infomaniak.enabled': 'false',
    'backup.infomaniak.endpoint': 'https://s3.swiss-backup.infomaniak.com',
    'backup.infomaniak.region': 'rma',
    'backup.infomaniak.bucket': '',
    'backup.infomaniak.accessKey': '',
    'backup.infomaniak.secretKey': '',
  })
  const [infoMsg, setInfoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [infoSaved, setInfoSaved] = useState(false)
  const [infoTesting, setInfoTesting] = useState(false)

  useEffect(() => {
    if (!settings) return
    setInfo({
      'backup.infomaniak.enabled': settings['backup.infomaniak.enabled'] ?? 'false',
      'backup.infomaniak.endpoint': settings['backup.infomaniak.endpoint'] ?? 'https://s3.swiss-backup.infomaniak.com',
      'backup.infomaniak.region': settings['backup.infomaniak.region'] ?? 'rma',
      'backup.infomaniak.bucket': settings['backup.infomaniak.bucket'] ?? '',
      'backup.infomaniak.accessKey': settings['backup.infomaniak.accessKey'] ?? '',
      'backup.infomaniak.secretKey': settings['backup.infomaniak.secretKey'] ?? '',
    })
  }, [settings])

  const handleSaveInfo = async () => {
    await updateSettings.mutateAsync(info)
    setInfoSaved(true); setTimeout(() => setInfoSaved(false), 3000)
  }

  const handleTest = async () => {
    setInfoMsg(null); setInfoTesting(true)
    try {
      const r = await apiPost<{ ok: boolean; message: string }>('/settings/test-backup-target', { target: 'infomaniak' })
      setInfoMsg({ type: 'success', text: r.message })
    } catch (err) {
      setInfoMsg({ type: 'error', text: err instanceof Error ? err.message : 'Test fehlgeschlagen' })
    } finally { setInfoTesting(false) }
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.backup.intro', 'Backups laufen über den bestehenden WireGuard-Tunnel zum Pi und werden auf Infomaniak Swiss Backup hochgeladen. Pro Gerät bleiben die letzten 5 Backups erhalten.')}
      </Typography>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Infomaniak Swiss Backup (S3)</Typography>
              <FormControlLabel
                control={<Switch
                  checked={info['backup.infomaniak.enabled'] === 'true'}
                  onChange={(e) => setInfo({ ...info, 'backup.infomaniak.enabled': e.target.checked ? 'true' : 'false' })}
                />}
                label={t('common.active', 'Aktiv')}
              />
            </Box>
            <Box display="flex" gap={2}>
              <TextField
                label="Endpoint"
                value={info['backup.infomaniak.endpoint']}
                onChange={(e) => setInfo({ ...info, 'backup.infomaniak.endpoint': e.target.value })}
                placeholder="https://s3.swiss-backup.infomaniak.com"
                fullWidth size="small"
              />
              <TextField
                label="Region"
                value={info['backup.infomaniak.region']}
                onChange={(e) => setInfo({ ...info, 'backup.infomaniak.region': e.target.value })}
                placeholder="rma"
                size="small"
                sx={{ minWidth: 120 }}
              />
            </Box>
            <TextField
              label="Bucket"
              value={info['backup.infomaniak.bucket']}
              onChange={(e) => setInfo({ ...info, 'backup.infomaniak.bucket': e.target.value })}
              fullWidth size="small"
              helperText={t('settings.backup.infomaniak.bucketHint', 'Bucket-Name aus dem Infomaniak-Manager (Swiss Backup → S3).')}
            />
            <Box display="flex" gap={2}>
              <TextField
                label="Access Key"
                value={info['backup.infomaniak.accessKey']}
                onChange={(e) => setInfo({ ...info, 'backup.infomaniak.accessKey': e.target.value })}
                fullWidth size="small"
              />
              <TextField
                label="Secret Key"
                type="password"
                value={info['backup.infomaniak.secretKey']}
                onChange={(e) => setInfo({ ...info, 'backup.infomaniak.secretKey': e.target.value })}
                fullWidth size="small"
              />
            </Box>
            {infoMsg && <Alert severity={infoMsg.type}>{infoMsg.text}</Alert>}
            {infoSaved && <Alert severity="success">{t('common.saved', 'Gespeichert')}</Alert>}
            <Box display="flex" gap={1}>
              <Button variant="contained" onClick={handleSaveInfo}>{t('common.save', 'Speichern')}</Button>
              <Button variant="outlined" onClick={handleTest} disabled={infoTesting}>
                {infoTesting ? t('common.testing', 'Teste…') : t('common.test', 'Verbindung testen')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
