import { useState, useEffect } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import Link from '@mui/material/Link'
import { ErzeugerSettingsTab } from '../components/settings/ErzeugerSettingsTab'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Paper from '@mui/material/Paper'
import LinearProgress from '@mui/material/LinearProgress'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import DownloadIcon from '@mui/icons-material/Download'
import SendIcon from '@mui/icons-material/Send'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import StorageIcon from '@mui/icons-material/Storage'
import MemoryIcon from '@mui/icons-material/Memory'
import { useSettings, useUpdateSettings, useSystemInfo, useCleanupActivityLog, useDeleteAllActivityLog, type SystemInfo } from '../features/settings/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
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

  // Erzeuger-Form
  const [erzeugerSerialRequired, setErzeugerSerialRequired] = useState(false)
  const [erzeugerSaved, setErzeugerSaved] = useState(false)

  // DeepL-Form
  const [deeplForm, setDeeplForm] = useState({ 'deepl.apiKey': '', 'deepl.tier': 'free' })
  const [deeplSaved, setDeeplSaved] = useState(false)
  const [deeplTestMsg, setDeeplTestMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deeplTesting, setDeeplTesting] = useState(false)

  // System-Tab Retention
  const [retentionDays, setRetentionDays] = useState('90')
  const [retentionSaved, setRetentionSaved] = useState(false)
  const [cleanupMsg, setCleanupMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const cleanupMutation = useCleanupActivityLog()
  const deleteAllMutation = useDeleteAllActivityLog()
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false)

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
      setRetentionDays(settings['activityLog.retentionDays'] ?? '90')
      setDeeplForm({
        'deepl.apiKey': settings['deepl.apiKey'] ?? '',
        'deepl.tier': settings['deepl.tier'] ?? 'free',
      })
      setErzeugerSerialRequired(settings['erzeuger.serialRequired'] === 'true')
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

  const handleSaveErzeuger = async () => {
    await updateSettings.mutateAsync({ 'erzeuger.serialRequired': erzeugerSerialRequired ? 'true' : 'false' })
    setErzeugerSaved(true)
    setTimeout(() => setErzeugerSaved(false), 3000)
  }

  const handleSaveDeepl = async () => {
    await updateSettings.mutateAsync(deeplForm)
    setDeeplSaved(true)
    setTimeout(() => setDeeplSaved(false), 3000)
  }

  const handleTestDeepl = async () => {
    setDeeplTestMsg(null)
    setDeeplTesting(true)
    try {
      const result = await apiPost<{ message: string }>('/settings/test-deepl', {})
      setDeeplTestMsg({ type: 'success', text: result.message })
    } catch (err) {
      setDeeplTestMsg({ type: 'error', text: err instanceof Error ? err.message : 'Test fehlgeschlagen' })
    } finally {
      setDeeplTesting(false)
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

  const { data: sysInfo, isLoading: sysLoading, refetch: refetchSystem } = useSystemInfo(isAdmin)

  const handleSaveRetention = async () => {
    await updateSettings.mutateAsync({ 'activityLog.retentionDays': retentionDays })
    setRetentionSaved(true)
    setTimeout(() => setRetentionSaved(false), 3000)
  }

  const handleCleanup = async () => {
    setCleanupMsg(null)
    try {
      const result = await cleanupMutation.mutateAsync()
      setCleanupMsg({
        type: 'success',
        text: `${result.deleted} Einträge gelöscht (älter als ${result.retentionDays} Tage)`,
      })
    } catch (err) {
      setCleanupMsg({ type: 'error', text: err instanceof Error ? err.message : 'Cleanup fehlgeschlagen' })
    }
  }

  const handleDeleteAll = async () => {
    setCleanupMsg(null)
    setDeleteAllConfirmOpen(false)
    try {
      const result = await deleteAllMutation.mutateAsync()
      setCleanupMsg({
        type: 'success',
        text: `Alle ${result.deleted} Einträge wurden gelöscht.`,
      })
    } catch (err) {
      setCleanupMsg({ type: 'error', text: err instanceof Error ? err.message : 'Löschen fehlgeschlagen' })
    }
  }

  if ((canSeePiSetup || isAdmin) && isLoading) {
    return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  }

  // Dynamische Tabs aufbauen
  const tabs: { label: string; key: string }[] = [{ label: 'Account', key: 'account' }]
  if (canSeePiSetup) tabs.push({ label: t('settings.tabPiSetup'), key: 'pi' })
  if (isAdmin) tabs.push({ label: 'E-Mail', key: 'mail' })
  if (isAdmin) tabs.push({ label: 'Übersetzung', key: 'deepl' })
  if (isAdmin) tabs.push({ label: 'Erzeuger', key: 'erzeuger' })
  if (isAdmin) tabs.push({ label: 'System', key: 'system' })
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

      {activeKey === 'deepl' && (
        <Card sx={{ maxWidth: 720 }}>
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 3 }}>
            <Typography variant="h6">Automatische Übersetzung (DeepL)</Typography>
            <Typography variant="body2" color="text.secondary">
              Wenn ein API-Key hinterlegt ist, werden Wiki-Seiten beim Speichern
              automatisch in alle unterstützten Sprachen (EN, FR, IT) übersetzt.
              Einen kostenlosen Key (500.000 Zeichen/Monat) gibt es unter{' '}
              <Link href="https://www.deepl.com/de/pro-api" target="_blank" rel="noopener">
                deepl.com/pro-api
              </Link>.
            </Typography>

            <TextField
              label="API-Key"
              value={deeplForm['deepl.apiKey']}
              onChange={(e) => setDeeplForm((f) => ({ ...f, 'deepl.apiKey': e.target.value }))}
              type="password"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
              helperText={'Leer lassen → Wiki-Übersetzung deaktiviert'}
              fullWidth
              autoComplete="off"
            />

            <TextField
              select
              label="Tier"
              value={deeplForm['deepl.tier']}
              onChange={(e) => setDeeplForm((f) => ({ ...f, 'deepl.tier': e.target.value }))}
              helperText="Free = api-free.deepl.com · Pro = api.deepl.com"
              SelectProps={{ native: true }}
              fullWidth
            >
              <option value="free">Free (Standard)</option>
              <option value="pro">Pro (kostenpflichtig)</option>
            </TextField>

            {deeplSaved && <Alert severity="success">DeepL-Einstellungen gespeichert.</Alert>}
            {deeplTestMsg && <Alert severity={deeplTestMsg.type}>{deeplTestMsg.text}</Alert>}

            <Box display="flex" gap={2}>
              <Button
                variant="contained"
                onClick={handleSaveDeepl}
                disabled={updateSettings.isPending}
              >
                Speichern
              </Button>
              <Button
                variant="outlined"
                onClick={handleTestDeepl}
                disabled={deeplTesting || !deeplForm['deepl.apiKey']}
              >
                Verbindung testen
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {activeKey === 'erzeuger' && (
        <ErzeugerSettingsTab
          serialRequired={erzeugerSerialRequired}
          onSerialRequiredChange={setErzeugerSerialRequired}
          saved={erzeugerSaved}
          onSave={handleSaveErzeuger}
        />
      )}

      {activeKey === 'system' && (
        <SystemTab
          sysInfo={sysInfo}
          loading={sysLoading}
          retentionDays={retentionDays}
          onRetentionChange={setRetentionDays}
          onSaveRetention={handleSaveRetention}
          retentionSaved={retentionSaved}
          onCleanup={handleCleanup}
          cleanupPending={cleanupMutation.isPending}
          cleanupMsg={cleanupMsg}
          onRefresh={() => refetchSystem()}
          updatePending={updateSettings.isPending}
          onDeleteAllRequest={() => setDeleteAllConfirmOpen(true)}
          deleteAllPending={deleteAllMutation.isPending}
        />
      )}

      <ConfirmDialog
        open={deleteAllConfirmOpen}
        title="Alle Log-Einträge löschen?"
        message={
          sysInfo
            ? `Wirklich ALLE ${sysInfo.activityLog.totalCount.toLocaleString()} Aktivitätslog-Einträge unwiderruflich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`
            : 'Wirklich ALLE Aktivitätslog-Einträge unwiderruflich löschen?'
        }
        confirmLabel="Alle löschen"
        onConfirm={handleDeleteAll}
        onClose={() => setDeleteAllConfirmOpen(false)}
        loading={deleteAllMutation.isPending}
      />
    </Box>
  )
}

// ─── System-Tab ────────────────────────────────────────────────────────────────

interface SystemTabProps {
  sysInfo?: SystemInfo
  loading: boolean
  retentionDays: string
  onRetentionChange: (v: string) => void
  onSaveRetention: () => void | Promise<void>
  retentionSaved: boolean
  onCleanup: () => void | Promise<void>
  cleanupPending: boolean
  cleanupMsg: { type: 'success' | 'error'; text: string } | null
  onRefresh: () => void
  updatePending: boolean
  onDeleteAllRequest: () => void
  deleteAllPending: boolean
}

function SystemTab({
  sysInfo, loading, retentionDays, onRetentionChange, onSaveRetention, retentionSaved,
  onCleanup, cleanupPending, cleanupMsg, onRefresh, updatePending,
  onDeleteAllRequest, deleteAllPending,
}: SystemTabProps) {
  if (loading && !sysInfo) {
    return <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box>
  }
  if (!sysInfo) return null

  const s = sysInfo.server
  const d = sysInfo.db
  const log = sysInfo.activityLog

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">System-Information</Typography>
        <Tooltip title="Aktualisieren">
          <IconButton size="small" onClick={onRefresh}><RefreshIcon /></IconButton>
        </Tooltip>
      </Box>

      {/* Server-Auslastung */}
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <MemoryIcon color="primary" fontSize="small" />
            <Typography variant="h6">Server-Auslastung</Typography>
          </Box>

          <Stack spacing={2}>
            {/* CPU Load */}
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="baseline">
                <Typography variant="caption" color="text.secondary">
                  CPU-Last (1 Min) · {s.cpus} Kerne
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {s.loadAvg.map((l) => l.toFixed(2)).join(' / ')}  ·  {s.loadPercent[0].toFixed(1)}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, s.loadPercent[0])}
                color={s.loadPercent[0] > 80 ? 'error' : s.loadPercent[0] > 50 ? 'warning' : 'success'}
                sx={{ height: 8, borderRadius: 1, mt: 0.5 }}
              />
            </Box>

            {/* Memory System */}
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="baseline">
                <Typography variant="caption" color="text.secondary">
                  RAM (System)
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {formatBytes(s.memUsed)} / {formatBytes(s.memTotal)} ({s.memPercent.toFixed(1)}%)
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={s.memPercent}
                color={s.memPercent > 85 ? 'error' : s.memPercent > 70 ? 'warning' : 'success'}
                sx={{ height: 8, borderRadius: 1, mt: 0.5 }}
              />
            </Box>

            {/* Process Heap */}
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="baseline">
                <Typography variant="caption" color="text.secondary">
                  Backend-Prozess (Heap)
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {formatBytes(s.processMemHeapUsed)} / {formatBytes(s.processMemHeapTotal)}  ·  RSS {formatBytes(s.processMemRss)}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={s.processMemHeapTotal > 0 ? (s.processMemHeapUsed / s.processMemHeapTotal) * 100 : 0}
                sx={{ height: 6, borderRadius: 1, mt: 0.5 }}
              />
            </Box>
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Box display="grid" gridTemplateColumns="auto 1fr" columnGap={2} rowGap={0.5} sx={{ fontSize: '0.8rem' }}>
            <InfoRow label="Hostname" value={s.hostname} mono />
            <InfoRow label="Platform" value={`${s.platform} (${s.arch})`} />
            <InfoRow label="Node.js" value={s.nodeVersion} mono />
            <InfoRow label="Prozess-Uptime" value={formatUptime(s.uptimeProcessSec)} />
            <InfoRow label="System-Uptime" value={formatUptime(s.uptimeSystemSec)} />
          </Box>
        </CardContent>
      </Card>

      {/* Datenbank */}
      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={2}>
            <StorageIcon color="primary" fontSize="small" />
            <Typography variant="h6">Datenbank</Typography>
          </Box>

          <Box display="grid" gridTemplateColumns="auto 1fr" columnGap={2} rowGap={0.5} mb={2} sx={{ fontSize: '0.85rem' }}>
            <InfoRow label="Host" value={d.host ?? '—'} mono />
            <InfoRow label="Datenbank" value={d.name ?? '—'} mono />
            <InfoRow label="User" value={d.user ?? '—'} mono />
            <InfoRow label="Version" value={d.version} />
            <InfoRow label="Gesamtgrösse" value={d.sizePretty} />
          </Box>

          <Typography variant="caption" color="text.secondary">Tabellen (Top-{d.tables.length})</Typography>
          <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', mt: 0.5 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tabelle</TableCell>
                  <TableCell align="right">Zeilen</TableCell>
                  <TableCell align="right">Grösse</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.tables.map((tbl) => (
                  <TableRow key={tbl.name} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{tbl.name}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {tbl.rowCount.toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{tbl.pretty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Activity-Log Retention */}
      <Card>
        <CardContent>
          <Typography variant="h6" mb={1}>Aktivitätslog-Aufbewahrung</Typography>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Einträge älter als {retentionDays} Tage werden täglich um 03:00 Uhr automatisch gelöscht.
          </Typography>

          <Box display="grid" gridTemplateColumns="auto 1fr" columnGap={2} rowGap={0.5} mb={2} sx={{ fontSize: '0.85rem' }}>
            <InfoRow label="Einträge gesamt" value={log.totalCount.toLocaleString()} />
            {log.oldestAt && <InfoRow label="Ältester Eintrag" value={new Date(log.oldestAt).toLocaleString()} />}
            {log.newestAt && <InfoRow label="Neuester Eintrag" value={new Date(log.newestAt).toLocaleString()} />}
          </Box>

          <Box display="flex" gap={2} alignItems="flex-start" flexWrap="wrap">
            <TextField
              label="Aufbewahrung (Tage)"
              size="small"
              type="number"
              value={retentionDays}
              onChange={(e) => onRetentionChange(e.target.value)}
              inputProps={{ min: 1, max: 3650 }}
              sx={{ width: 180 }}
            />
            <Button variant="contained" onClick={onSaveRetention} disabled={updatePending} sx={{ height: 40 }}>
              Speichern
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={onCleanup}
              disabled={cleanupPending}
              sx={{ height: 40 }}
            >
              Jetzt bereinigen
            </Button>
            <Button
              variant="contained"
              color="error"
              startIcon={<DeleteForeverIcon />}
              onClick={onDeleteAllRequest}
              disabled={deleteAllPending}
              sx={{ height: 40 }}
            >
              Alle Logs löschen
            </Button>
          </Box>

          {retentionSaved && <Alert severity="success" sx={{ mt: 2 }}>Einstellung gespeichert.</Alert>}
          {cleanupMsg && <Alert severity={cleanupMsg.type} sx={{ mt: 2 }}>{cleanupMsg.text}</Alert>}
        </CardContent>
      </Card>
    </Stack>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>{label}</Typography>
      <Typography variant="caption" sx={{ fontFamily: mono ? 'monospace' : undefined }}>{value}</Typography>
    </>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
