import { useEffect, useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CircularProgress from '@mui/material/CircularProgress'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import AutoModeIcon from '@mui/icons-material/AutoMode'
import { useTranslation } from 'react-i18next'
import { useSettings, useUpdateSettings } from '../../features/settings/queries'
import { useCloudBackups, useTriggerCloudBackup, useDeleteCloudBackup, type CloudBackup } from '../../features/cloud-backups/queries'

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function StatusChip({ b }: { b: CloudBackup }) {
  const map: Record<CloudBackup['status'], 'default' | 'info' | 'success' | 'error'> = {
    PENDING: 'default', UPLOADING: 'info', DISTRIBUTING: 'info', OK: 'success', FAILED: 'error',
  }
  return <Chip size="small" color={map[b.status]} label={b.status} />
}

type Form = {
  'cloud.backup.enabled': string
  'cloud.backup.intervalHours': string
  'cloud.backup.retentionDays': string
}

export function CloudBackupCard() {
  const { t } = useTranslation()
  const { data: settings } = useSettings(true)
  const updateSettings = useUpdateSettings()
  const { data: backups, isLoading } = useCloudBackups()
  const trigger = useTriggerCloudBackup()
  const deleteBackup = useDeleteCloudBackup()

  const [form, setForm] = useState<Form>({
    'cloud.backup.enabled': 'true',
    'cloud.backup.intervalHours': '24',
    'cloud.backup.retentionDays': '14',
  })
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) return
    setForm({
      'cloud.backup.enabled': settings['cloud.backup.enabled'] ?? 'true',
      'cloud.backup.intervalHours': settings['cloud.backup.intervalHours'] ?? '24',
      'cloud.backup.retentionDays': settings['cloud.backup.retentionDays'] ?? '14',
    })
  }, [settings])

  const handleSave = async () => {
    await updateSettings.mutateAsync(form)
    setSaved(true); setTimeout(() => setSaved(false), 3000)
  }

  const handleTrigger = async () => {
    setErr(null)
    try { await trigger.mutateAsync() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  const handleDelete = async (id: string) => {
    setErr(null)
    try { await deleteBackup.mutateAsync(id) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }

  const inflight = backups?.some((b) => b.status === 'PENDING' || b.status === 'UPLOADING' || b.status === 'DISTRIBUTING')

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">{t('settings.cloudBackup.title', 'Cloud-DB-Backup')}</Typography>
            <FormControlLabel
              control={<Switch
                checked={form['cloud.backup.enabled'] === 'true'}
                onChange={(e) => setForm({ ...form, 'cloud.backup.enabled': e.target.checked ? 'true' : 'false' })}
              />}
              label={t('common.active', 'Aktiv')}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t('settings.cloudBackup.intro', 'Täglicher Komplett-Dump der Cloud (pg_dump + Uploads-Ordner mit Anlagen-Fotos und Wiki-Anhängen) als tar.gz-Bundle ins Swift-Target. Admin-only. Restore manuell via tar+pg_restore – siehe DEPLOYMENT.md.')}
          </Typography>

          <Box display="flex" gap={2} flexWrap="wrap">
            <TextField
              label={t('settings.cloudBackup.interval', 'Intervall (Stunden)')}
              type="number"
              value={form['cloud.backup.intervalHours']}
              onChange={(e) => setForm({ ...form, 'cloud.backup.intervalHours': e.target.value })}
              size="small"
              sx={{ maxWidth: 180 }}
              slotProps={{ htmlInput: { min: 1, max: 168 } }}
              helperText={t('settings.cloudBackup.intervalHint', 'Standard 24h.')}
            />
            <TextField
              label={t('settings.cloudBackup.retention', 'Aufbewahrung (Tage)')}
              type="number"
              value={form['cloud.backup.retentionDays']}
              onChange={(e) => setForm({ ...form, 'cloud.backup.retentionDays': e.target.value })}
              size="small"
              sx={{ maxWidth: 200 }}
              slotProps={{ htmlInput: { min: 1, max: 365 } }}
              helperText={t('settings.cloudBackup.retentionHint', 'Ältere OK-Backups werden nach jedem neuen Dump gelöscht.')}
            />
          </Box>

          {saved && <Alert severity="success">{t('common.saved', 'Gespeichert')}</Alert>}
          {err && <Alert severity="error" onClose={() => setErr(null)}>{err}</Alert>}

          <Box display="flex" gap={1}>
            <Button variant="contained" onClick={handleSave}>{t('common.save', 'Speichern')}</Button>
            <Button
              variant="outlined"
              startIcon={inflight || trigger.isPending ? <CircularProgress size={16} /> : <CloudUploadIcon />}
              onClick={handleTrigger}
              disabled={inflight || trigger.isPending}
            >
              {t('settings.cloudBackup.trigger', 'Jetzt Backup erstellen')}
            </Button>
          </Box>

          <Box mt={1}>
            <Typography variant="subtitle2" gutterBottom>{t('settings.cloudBackup.history', 'Letzte Backups')}</Typography>
            {isLoading ? (
              <Box display="flex" justifyContent="center" py={2}><CircularProgress size={24} /></Box>
            ) : (backups && backups.length > 0) ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('backup.col.created', 'Erstellt')}</TableCell>
                    <TableCell>{t('backup.col.size', 'Grösse')}</TableCell>
                    <TableCell>{t('backup.col.status', 'Status')}</TableCell>
                    <TableCell align="right">{t('backup.col.actions', 'Aktionen')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {backups.map((b) => (
                    <TableRow key={b.id} hover>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={0.5}>
                          {new Date(b.createdAt).toLocaleString('de-CH')}
                          {b.trigger === 'auto' && (
                            <Tooltip title={t('backup.triggerAuto', 'Automatisch erstellt')}>
                              <AutoModeIcon fontSize="small" color="action" />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{formatSize(b.sizeBytes)}</TableCell>
                      <TableCell>
                        <Tooltip title={b.errorMessage ?? ''}>
                          <span><StatusChip b={b} /></span>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        {b.status === 'OK' && (
                          <Tooltip title={t('settings.cloudBackup.download', 'Bundle herunterladen (tar.gz)')}>
                            <IconButton
                              size="small"
                              component="a"
                              href={`/api/cloud-backups/${b.id}/download`}
                              download
                            >
                              <DownloadIcon fontSize="small" color="primary" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title={t('backup.delete', 'Backup löschen')}>
                          <IconButton size="small" color="error" onClick={() => handleDelete(b.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t('settings.cloudBackup.empty', 'Noch keine Cloud-Backups vorhanden.')}
              </Typography>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
