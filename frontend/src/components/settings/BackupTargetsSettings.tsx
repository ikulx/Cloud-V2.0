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

type SynoForm = {
  'backup.syno.enabled': string
  'backup.syno.url': string
  'backup.syno.user': string
  'backup.syno.password': string
  'backup.syno.basePath': string
}

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

  const [syno, setSyno] = useState<SynoForm>({
    'backup.syno.enabled': 'false',
    'backup.syno.url': '',
    'backup.syno.user': '',
    'backup.syno.password': '',
    'backup.syno.basePath': '/ycontrol-backups',
  })
  const [info, setInfo] = useState<InfoForm>({
    'backup.infomaniak.enabled': 'false',
    'backup.infomaniak.endpoint': 'https://s3.swiss-backup.infomaniak.com',
    'backup.infomaniak.region': 'rma',
    'backup.infomaniak.bucket': '',
    'backup.infomaniak.accessKey': '',
    'backup.infomaniak.secretKey': '',
  })
  const [synoMsg, setSynoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [infoMsg, setInfoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [synoSaved, setSynoSaved] = useState(false)
  const [infoSaved, setInfoSaved] = useState(false)
  const [synoTesting, setSynoTesting] = useState(false)
  const [infoTesting, setInfoTesting] = useState(false)

  useEffect(() => {
    if (!settings) return
    setSyno({
      'backup.syno.enabled': settings['backup.syno.enabled'] ?? 'false',
      'backup.syno.url': settings['backup.syno.url'] ?? '',
      'backup.syno.user': settings['backup.syno.user'] ?? '',
      'backup.syno.password': settings['backup.syno.password'] ?? '',
      'backup.syno.basePath': settings['backup.syno.basePath'] ?? '/ycontrol-backups',
    })
    setInfo({
      'backup.infomaniak.enabled': settings['backup.infomaniak.enabled'] ?? 'false',
      'backup.infomaniak.endpoint': settings['backup.infomaniak.endpoint'] ?? 'https://s3.swiss-backup.infomaniak.com',
      'backup.infomaniak.region': settings['backup.infomaniak.region'] ?? 'rma',
      'backup.infomaniak.bucket': settings['backup.infomaniak.bucket'] ?? '',
      'backup.infomaniak.accessKey': settings['backup.infomaniak.accessKey'] ?? '',
      'backup.infomaniak.secretKey': settings['backup.infomaniak.secretKey'] ?? '',
    })
  }, [settings])

  const handleSaveSyno = async () => {
    await updateSettings.mutateAsync(syno)
    setSynoSaved(true); setTimeout(() => setSynoSaved(false), 3000)
  }
  const handleSaveInfo = async () => {
    await updateSettings.mutateAsync(info)
    setInfoSaved(true); setTimeout(() => setInfoSaved(false), 3000)
  }

  const handleTest = async (target: 'syno' | 'infomaniak') => {
    const setMsg = target === 'syno' ? setSynoMsg : setInfoMsg
    const setBusy = target === 'syno' ? setSynoTesting : setInfoTesting
    setMsg(null); setBusy(true)
    try {
      const r = await apiPost<{ ok: boolean; message: string }>('/settings/test-backup-target', { target })
      setMsg({ type: 'success', text: r.message })
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Test fehlgeschlagen' })
    } finally { setBusy(false) }
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.backup.intro', 'Konfiguriere bis zu zwei Backup-Ziele. Wenn beide aktiv sind, werden Backups parallel an beide Ziele geschrieben. Pro Gerät bleiben max. 5 Backups erhalten.')}
      </Typography>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Synology NAS (WebDAV)</Typography>
              <FormControlLabel
                control={<Switch
                  checked={syno['backup.syno.enabled'] === 'true'}
                  onChange={(e) => setSyno({ ...syno, 'backup.syno.enabled': e.target.checked ? 'true' : 'false' })}
                />}
                label={t('common.active', 'Aktiv')}
              />
            </Box>
            <TextField
              label="WebDAV-URL"
              value={syno['backup.syno.url']}
              onChange={(e) => setSyno({ ...syno, 'backup.syno.url': e.target.value })}
              placeholder="https://mein-syno.local:5006"
              fullWidth size="small"
              helperText={t('settings.backup.syno.urlHint', 'Synology DSM → Paket „WebDAV Server" aktivieren. Standardport 5006 (HTTPS) bzw. 5005 (HTTP).')}
            />
            <Box display="flex" gap={2}>
              <TextField
                label="Benutzer"
                value={syno['backup.syno.user']}
                onChange={(e) => setSyno({ ...syno, 'backup.syno.user': e.target.value })}
                fullWidth size="small"
              />
              <TextField
                label="Passwort"
                type="password"
                value={syno['backup.syno.password']}
                onChange={(e) => setSyno({ ...syno, 'backup.syno.password': e.target.value })}
                fullWidth size="small"
              />
            </Box>
            <TextField
              label={t('settings.backup.basePath', 'Basis-Pfad')}
              value={syno['backup.syno.basePath']}
              onChange={(e) => setSyno({ ...syno, 'backup.syno.basePath': e.target.value })}
              placeholder="/ycontrol-backups"
              fullWidth size="small"
              helperText={t('settings.backup.syno.pathHint', 'Wird angelegt, falls nicht vorhanden. Pro Gerät wird darunter ein Unterordner mit der Seriennummer erstellt.')}
            />
            {synoMsg && <Alert severity={synoMsg.type}>{synoMsg.text}</Alert>}
            {synoSaved && <Alert severity="success">{t('common.saved', 'Gespeichert')}</Alert>}
            <Box display="flex" gap={1}>
              <Button variant="contained" onClick={handleSaveSyno}>{t('common.save', 'Speichern')}</Button>
              <Button variant="outlined" onClick={() => handleTest('syno')} disabled={synoTesting}>
                {synoTesting ? t('common.testing', 'Teste…') : t('common.test', 'Verbindung testen')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

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
              <Button variant="outlined" onClick={() => handleTest('infomaniak')} disabled={infoTesting}>
                {infoTesting ? t('common.testing', 'Teste…') : t('common.test', 'Verbindung testen')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
