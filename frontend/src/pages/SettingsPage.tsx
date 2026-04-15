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
import Divider from '@mui/material/Divider'
import DownloadIcon from '@mui/icons-material/Download'
import { useSettings, useUpdateSettings } from '../features/settings/queries'
import { apiFetch, apiPatch } from '../lib/api'
import { useTranslation } from 'react-i18next'
import { useSession } from '../context/SessionContext'

export function SettingsPage() {
  const { t } = useTranslation()
  const { me, hasPermission } = useSession()
  const canSeePiSetup = hasPermission('devices:update')

  const { data: settings, isLoading } = useSettings(canSeePiSetup)
  const updateSettings = useUpdateSettings()

  // Tab 0 = Account (immer sichtbar), Tab 1 = Pi-Setup (nur mit devices:update)
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState({ 'pi.serverUrl': '', 'pi.mqttHost': '', 'pi.mqttPort': '1883' })
  const [saved, setSaved] = useState(false)

  // Account-Form
  const [account, setAccount] = useState({
    firstName: '',
    lastName: '',
    email: '',
    currentPassword: '',
    newPassword: '',
    newPasswordRepeat: '',
  })
  const [accountMsg, setAccountMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [accountSaving, setAccountSaving] = useState(false)

  useEffect(() => {
    if (settings) {
      setForm({
        'pi.serverUrl': settings['pi.serverUrl'] ?? '',
        'pi.mqttHost': settings['pi.mqttHost'] ?? '',
        'pi.mqttPort': settings['pi.mqttPort'] ?? '1883',
      })
    }
  }, [settings])

  useEffect(() => {
    if (me) {
      setAccount((a) => ({
        ...a,
        firstName: me.firstName,
        lastName: me.lastName,
        email: me.email,
      }))
    }
  }, [me])

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

  const handleSaveAccount = async () => {
    setAccountMsg(null)

    const wantsPasswordChange = account.newPassword.length > 0 || account.currentPassword.length > 0
    if (wantsPasswordChange) {
      if (account.newPassword.length < 8) {
        setAccountMsg({ type: 'error', text: 'Neues Passwort muss mindestens 8 Zeichen lang sein.' })
        return
      }
      if (account.newPassword !== account.newPasswordRepeat) {
        setAccountMsg({ type: 'error', text: 'Passwörter stimmen nicht überein.' })
        return
      }
      if (!account.currentPassword) {
        setAccountMsg({ type: 'error', text: 'Bitte aktuelles Passwort eingeben.' })
        return
      }
    }

    const body: Record<string, unknown> = {}
    if (account.firstName !== me?.firstName) body.firstName = account.firstName
    if (account.lastName !== me?.lastName) body.lastName = account.lastName
    if (account.email !== me?.email) body.email = account.email
    if (wantsPasswordChange) {
      body.currentPassword = account.currentPassword
      body.newPassword = account.newPassword
    }

    if (Object.keys(body).length === 0) {
      setAccountMsg({ type: 'error', text: 'Keine Änderungen übermittelt.' })
      return
    }

    setAccountSaving(true)
    try {
      await apiPatch('/me', body)
      setAccountMsg({ type: 'success', text: 'Änderungen gespeichert. Bitte melde dich ggf. neu an.' })
      setAccount((a) => ({ ...a, currentPassword: '', newPassword: '', newPasswordRepeat: '' }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Speichern fehlgeschlagen'
      setAccountMsg({ type: 'error', text: message })
    } finally {
      setAccountSaving(false)
    }
  }

  if (canSeePiSetup && isLoading) {
    return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  }

  return (
    <Box>
      <Typography variant="h5" mb={3}>{t('settings.title')}</Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label="Account" />
        {canSeePiSetup && <Tab label={t('settings.tabPiSetup')} />}
      </Tabs>

      {tab === 0 && (
        <Card sx={{ maxWidth: 560 }}>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 3 }}>
            <Typography variant="h6">Mein Account</Typography>
            <Typography variant="body2" color="text.secondary">
              Ändere hier deinen Namen, deine E-Mail-Adresse oder dein Passwort.
            </Typography>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Vorname"
                value={account.firstName}
                onChange={(e) => setAccount((a) => ({ ...a, firstName: e.target.value }))}
                fullWidth
              />
              <TextField
                label="Nachname"
                value={account.lastName}
                onChange={(e) => setAccount((a) => ({ ...a, lastName: e.target.value }))}
                fullWidth
              />
            </Box>

            <TextField
              label="E-Mail"
              type="email"
              value={account.email}
              onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))}
              fullWidth
            />

            <Divider sx={{ my: 1 }}>Passwort ändern (optional)</Divider>

            <TextField
              label="Aktuelles Passwort"
              type="password"
              autoComplete="current-password"
              value={account.currentPassword}
              onChange={(e) => setAccount((a) => ({ ...a, currentPassword: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Neues Passwort"
              type="password"
              autoComplete="new-password"
              value={account.newPassword}
              onChange={(e) => setAccount((a) => ({ ...a, newPassword: e.target.value }))}
              helperText="Mindestens 8 Zeichen"
              fullWidth
            />
            <TextField
              label="Neues Passwort wiederholen"
              type="password"
              autoComplete="new-password"
              value={account.newPasswordRepeat}
              onChange={(e) => setAccount((a) => ({ ...a, newPasswordRepeat: e.target.value }))}
              fullWidth
            />

            {accountMsg && <Alert severity={accountMsg.type}>{accountMsg.text}</Alert>}

            <Box>
              <Button variant="contained" onClick={handleSaveAccount} disabled={accountSaving}>
                Speichern
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {canSeePiSetup && tab === 1 && (
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
