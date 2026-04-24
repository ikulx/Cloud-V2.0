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
import { CloudBackupCard } from './CloudBackupCard'

type SwiftForm = {
  'backup.infomaniakSwift.enabled': string
  'backup.infomaniakSwift.authUrl': string
  'backup.infomaniakSwift.username': string
  'backup.infomaniakSwift.password': string
  'backup.infomaniakSwift.userDomain': string
  'backup.infomaniakSwift.projectName': string
  'backup.infomaniakSwift.projectDomain': string
  'backup.infomaniakSwift.region': string
  'backup.infomaniakSwift.container': string
}

type AutoForm = {
  'backup.autoEnabled': string
  'backup.autoIntervalMinutes': string
}

export function BackupTargetsSettings() {
  const { t } = useTranslation()
  const { data: settings } = useSettings(true)
  const updateSettings = useUpdateSettings()

  const [auto, setAuto] = useState<AutoForm>({
    'backup.autoEnabled': 'true',
    'backup.autoIntervalMinutes': '1440',
  })
  const [autoSaved, setAutoSaved] = useState(false)

  const [swift, setSwift] = useState<SwiftForm>({
    'backup.infomaniakSwift.enabled': 'false',
    'backup.infomaniakSwift.authUrl': 'https://swiss-backup02.infomaniak.com/identity/v3',
    'backup.infomaniakSwift.username': '',
    'backup.infomaniakSwift.password': '',
    'backup.infomaniakSwift.userDomain': 'Default',
    'backup.infomaniakSwift.projectName': '',
    'backup.infomaniakSwift.projectDomain': 'Default',
    'backup.infomaniakSwift.region': 'RegionOne',
    'backup.infomaniakSwift.container': '',
  })
  const [swiftMsg, setSwiftMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [swiftSaved, setSwiftSaved] = useState(false)
  const [swiftTesting, setSwiftTesting] = useState(false)

  useEffect(() => {
    if (!settings) return
    setAuto({
      'backup.autoEnabled': settings['backup.autoEnabled'] ?? 'true',
      'backup.autoIntervalMinutes': settings['backup.autoIntervalMinutes'] ?? '1440',
    })
    setSwift({
      'backup.infomaniakSwift.enabled': settings['backup.infomaniakSwift.enabled'] ?? 'false',
      'backup.infomaniakSwift.authUrl': settings['backup.infomaniakSwift.authUrl'] ?? 'https://swiss-backup02.infomaniak.com/identity/v3',
      'backup.infomaniakSwift.username': settings['backup.infomaniakSwift.username'] ?? '',
      'backup.infomaniakSwift.password': settings['backup.infomaniakSwift.password'] ?? '',
      'backup.infomaniakSwift.userDomain': settings['backup.infomaniakSwift.userDomain'] ?? 'Default',
      'backup.infomaniakSwift.projectName': settings['backup.infomaniakSwift.projectName'] ?? '',
      'backup.infomaniakSwift.projectDomain': settings['backup.infomaniakSwift.projectDomain'] ?? 'Default',
      'backup.infomaniakSwift.region': settings['backup.infomaniakSwift.region'] ?? 'RegionOne',
      'backup.infomaniakSwift.container': settings['backup.infomaniakSwift.container'] ?? '',
    })
  }, [settings])

  const handleSaveSwift = async () => {
    await updateSettings.mutateAsync(swift)
    setSwiftSaved(true); setTimeout(() => setSwiftSaved(false), 3000)
  }
  const handleTestSwift = async () => {
    setSwiftMsg(null); setSwiftTesting(true)
    try {
      const r = await apiPost<{ ok: boolean; message: string }>('/settings/test-backup-target', { target: 'infomaniakSwift' })
      setSwiftMsg({ type: 'success', text: r.message })
    } catch (err) {
      setSwiftMsg({ type: 'error', text: err instanceof Error ? err.message : 'Test fehlgeschlagen' })
    } finally { setSwiftTesting(false) }
  }

  const handleSaveAuto = async () => {
    await updateSettings.mutateAsync(auto)
    setAutoSaved(true); setTimeout(() => setAutoSaved(false), 3000)
  }

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      <Typography variant="body2" color="text.secondary">
        {t('settings.backup.intro', 'Backups laufen über den bestehenden WireGuard-Tunnel zum Pi und werden auf Infomaniak Swiss Backup hochgeladen. Pro Gerät bleiben die letzten 5 Backups erhalten, plus 1 optional fixiertes Backup.')}
      </Typography>

      {/* Auto-Backup: Scheduler läuft alle 30 min und triggert ein Backup pro Gerät,
          wenn seit der letzten Config-Änderung das Intervall überschritten ist. */}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">{t('settings.backup.autoTitle', 'Automatisches Backup')}</Typography>
              <FormControlLabel
                control={<Switch
                  checked={auto['backup.autoEnabled'] === 'true'}
                  onChange={(e) => setAuto({ ...auto, 'backup.autoEnabled': e.target.checked ? 'true' : 'false' })}
                />}
                label={t('common.active', 'Aktiv')}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t('settings.backup.autoIntro', 'Pro Gerät erstellt die Cloud automatisch ein Backup, wenn seit der letzten lokalen Config-Änderung das Intervall abgelaufen ist. Pro Gerät kann das zusätzlich einzeln deaktiviert werden.')}
            </Typography>
            <TextField
              label={t('settings.backup.autoInterval', 'Intervall (Minuten)')}
              type="number"
              value={auto['backup.autoIntervalMinutes']}
              onChange={(e) => setAuto({ ...auto, 'backup.autoIntervalMinutes': e.target.value })}
              size="small"
              sx={{ maxWidth: 220 }}
              slotProps={{ htmlInput: { min: 5, max: 43200 } }}
              helperText={t('settings.backup.autoIntervalHint', 'Standard: 1440 min (= 24h). Für Tests bis auf 5 min runter, maximal 43 200 min (= 30 Tage). Scheduler pollt alle 2 min.')}
            />
            {autoSaved && <Alert severity="success">{t('common.saved', 'Gespeichert')}</Alert>}
            <Box>
              <Button variant="contained" onClick={handleSaveAuto}>{t('common.save', 'Speichern')}</Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Swiss Backup via OpenStack Swift (Keystone v3). Einziges konfigurierbares
          Backup-Ziel; S3-Support wurde per Entscheid Swift-only entfernt. */}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6">Infomaniak Swiss Backup (Swift)</Typography>
              <FormControlLabel
                control={<Switch
                  checked={swift['backup.infomaniakSwift.enabled'] === 'true'}
                  onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.enabled': e.target.checked ? 'true' : 'false' })}
                />}
                label={t('common.active', 'Aktiv')}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t('settings.backup.swiftIntro', 'Alternative zum S3-Block: Keystone-v3-Authentifizierung gegen OpenStack Swift. Die Zugangsdaten findest du im Infomaniak-Manager unter «Swiss Backup → Swift-Zugang».')}
            </Typography>
            <TextField
              label="Auth-URL (Keystone v3)"
              value={swift['backup.infomaniakSwift.authUrl']}
              onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.authUrl': e.target.value })}
              placeholder="https://swiss-backup02.infomaniak.com/identity/v3"
              fullWidth size="small"
            />
            <Box display="flex" gap={2}>
              <TextField
                label="Username"
                value={swift['backup.infomaniakSwift.username']}
                onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.username': e.target.value })}
                fullWidth size="small"
              />
              <TextField
                label="User-Domain"
                value={swift['backup.infomaniakSwift.userDomain']}
                onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.userDomain': e.target.value })}
                size="small"
                sx={{ minWidth: 160 }}
              />
            </Box>
            <TextField
              label="Password"
              type="password"
              value={swift['backup.infomaniakSwift.password']}
              onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.password': e.target.value })}
              fullWidth size="small"
            />
            <Box display="flex" gap={2}>
              <TextField
                label="Project"
                value={swift['backup.infomaniakSwift.projectName']}
                onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.projectName': e.target.value })}
                fullWidth size="small"
              />
              <TextField
                label="Project-Domain"
                value={swift['backup.infomaniakSwift.projectDomain']}
                onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.projectDomain': e.target.value })}
                size="small"
                sx={{ minWidth: 160 }}
              />
            </Box>
            <Box display="flex" gap={2}>
              <TextField
                label="Region"
                value={swift['backup.infomaniakSwift.region']}
                onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.region': e.target.value })}
                placeholder="RegionOne"
                size="small"
                sx={{ minWidth: 160 }}
              />
              <TextField
                label="Container"
                value={swift['backup.infomaniakSwift.container']}
                onChange={(e) => setSwift({ ...swift, 'backup.infomaniakSwift.container': e.target.value })}
                fullWidth size="small"
                helperText={t('settings.backup.swiftContainerHint', 'Container-Name im Swiss-Backup-Account (muss vorher angelegt sein).')}
              />
            </Box>
            {swiftMsg && <Alert severity={swiftMsg.type}>{swiftMsg.text}</Alert>}
            {swiftSaved && <Alert severity="success">{t('common.saved', 'Gespeichert')}</Alert>}
            <Box display="flex" gap={1}>
              <Button variant="contained" onClick={handleSaveSwift}>{t('common.save', 'Speichern')}</Button>
              <Button variant="outlined" onClick={handleTestSwift} disabled={swiftTesting}>
                {swiftTesting ? t('common.testing', 'Teste…') : t('common.test', 'Verbindung testen')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Cloud-DB-Backup (Admin-only): pg_dump auf dasselbe Swift-Target. */}
      <CloudBackupCard />
    </Box>
  )
}
