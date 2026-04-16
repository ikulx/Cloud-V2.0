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
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import DownloadIcon from '@mui/icons-material/Download'
import SendIcon from '@mui/icons-material/Send'
import { useSettings, useUpdateSettings } from '../features/settings/queries'
import { apiFetch, apiPatch, apiPost } from '../lib/api'
import { useTranslation } from 'react-i18next'
import { useSession } from '../context/SessionContext'

export function SettingsPage() {
  const { t } = useTranslation()
  const { me, hasPermission } = useSession()
  const canSeePiSetup = hasPermission('devices:update')
  const isAdmin = me?.roleName === 'admin'

  const { data: settings, isLoading } = useSettings(canSeePiSetup || isAdmin)
  const updateSettings = useUpdateSettings()

  // Tab 0 = Account, Tab 1 = Pi-Setup (devices:update), Tab 2 = E-Mail (admin)
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState({ 'pi.serverUrl': '', 'pi.mqttHost': '', 'pi.mqttPort': '1883' })
  const [saved, setSaved] = useState(false)

  // Mail-Form
  const [mailForm, setMailForm] = useState({
    'smtp.host': '', 'smtp.port': '587', 'smtp.secure': 'false',
    'smtp.user': '', 'smtp.password': '', 'smtp.from': '', 'app.url': '',
  })
  const [mailSaved, setMailSaved] = useState(false)
  const [testMailMsg, setTestMailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testMailSending, setTestMailSending] = useState(false)

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
      setMailForm({
        'smtp.host': settings['smtp.host'] ?? '',
        'smtp.port': settings['smtp.port'] ?? '587',
        'smtp.secure': settings['smtp.secure'] ?? 'false',
        'smtp.user': settings['smtp.user'] ?? '',
        'smtp.password': settings['smtp.password'] ?? '',
        'smtp.from': settings['smtp.from'] ?? '',
        'app.url': settings['app.url'] ?? '',
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

  const handleSaveMail = async () => {
    await updateSettings.mutateAsync(mailForm)
    setMailSaved(true)
    setTimeout(() => setMailSaved(false), 3000)
  }

  const handleTestMail = async () => {
    setTestMailMsg(null)
    setTestMailSending(true)
    try {
      const result = await apiPost<{ message: string }>('/settings/test-mail', {})
      setTestMailMsg({ type: 'success', text: result.message })
    } catch (err) {
      setTestMailMsg({ type: 'error', text: err instanceof Error ? err.message : 'Test fehlgeschlagen' })
    } finally {
      setTestMailSending(false)
    }
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

  if ((canSeePiSetup || isAdmin) && isLoading) {
    return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  }

  // Dynamische Tabs aufbauen
  const tabs: { label: string; key: string }[] = [{ label: 'Account', key: 'account' }]
  if (canSeePiSetup) tabs.push({ label: t('settings.tabPiSetup'), key: 'pi' })
  if (isAdmin) tabs.push({ label: 'E-Mail', key: 'mail' })
  const activeKey = tabs[tab]?.key ?? 'account'

  return (
    <Box>
      <Typography variant="h5" mb={3}>{t('settings.title')}</Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        {tabs.map((t) => <Tab key={t.key} label={t.label} />)}
      </Tabs>

      {activeKey === 'account' && (
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

      {activeKey === 'pi' && (
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

      {activeKey === 'mail' && (
        <Card sx={{ maxWidth: 560 }}>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 3 }}>
            <Typography variant="h6">E-Mail-Konfiguration (SMTP)</Typography>
            <Typography variant="body2" color="text.secondary">
              SMTP-Server für Einladungs-E-Mails und Benachrichtigungen.
            </Typography>

            <TextField
              label="SMTP-Host"
              value={mailForm['smtp.host']}
              onChange={(e) => setMailForm((f) => ({ ...f, 'smtp.host': e.target.value }))}
              placeholder="smtp.example.com"
              fullWidth
            />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Port"
                type="number"
                value={mailForm['smtp.port']}
                onChange={(e) => setMailForm((f) => ({ ...f, 'smtp.port': e.target.value }))}
                sx={{ width: 120 }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={mailForm['smtp.secure'] === 'true'}
                    onChange={(e) => setMailForm((f) => ({ ...f, 'smtp.secure': e.target.checked ? 'true' : 'false' }))}
                  />
                }
                label="SSL/TLS"
                sx={{ ml: 1 }}
              />
            </Box>
            <TextField
              label="Benutzername"
              value={mailForm['smtp.user']}
              onChange={(e) => setMailForm((f) => ({ ...f, 'smtp.user': e.target.value }))}
              autoComplete="off"
              fullWidth
            />
            <TextField
              label="Passwort"
              type="password"
              value={mailForm['smtp.password']}
              onChange={(e) => setMailForm((f) => ({ ...f, 'smtp.password': e.target.value }))}
              autoComplete="new-password"
              fullWidth
            />

            <Divider sx={{ my: 1 }}>Absender & App-URL</Divider>

            <TextField
              label="Absender (From)"
              value={mailForm['smtp.from']}
              onChange={(e) => setMailForm((f) => ({ ...f, 'smtp.from': e.target.value }))}
              placeholder="YControl Cloud <noreply@example.com>"
              fullWidth
            />
            <TextField
              label="App-URL"
              value={mailForm['app.url']}
              onChange={(e) => setMailForm((f) => ({ ...f, 'app.url': e.target.value }))}
              placeholder="https://cloud.ycontrol.ch"
              helperText="Basis-URL für Links in E-Mails (Einladungen etc.)"
              fullWidth
            />

            {mailSaved && <Alert severity="success">E-Mail-Einstellungen gespeichert.</Alert>}
            {testMailMsg && <Alert severity={testMailMsg.type}>{testMailMsg.text}</Alert>}

            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                onClick={handleSaveMail}
                disabled={updateSettings.isPending}
              >
                Speichern
              </Button>
              <Button
                variant="outlined"
                startIcon={<SendIcon />}
                onClick={handleTestMail}
                disabled={testMailSending || !mailForm['smtp.host']}
              >
                Test-Mail senden
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  )
}
