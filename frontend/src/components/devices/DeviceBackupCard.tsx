import { useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Snackbar from '@mui/material/Snackbar'
import BackupIcon from '@mui/icons-material/Backup'
import RestoreIcon from '@mui/icons-material/Restore'
import DeleteIcon from '@mui/icons-material/Delete'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import { useTranslation } from 'react-i18next'
import {
  useDeviceBackups,
  useStartBackup,
  useRestoreBackup,
  useDeleteBackup,
  type DeviceBackup,
  type BackupTargetStatus,
} from '../../features/backups/queries'
import { usePermission } from '../../hooks/usePermission'

interface Props {
  deviceId: string
  deviceOnline: boolean
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function targetLabel(t: 'syno' | 'infomaniak'): string {
  return t === 'syno' ? 'Syno NAS' : 'Infomaniak'
}

function TargetBadge({ name, status }: { name: 'syno' | 'infomaniak'; status: BackupTargetStatus }) {
  const colorMap: Record<BackupTargetStatus, 'default' | 'success' | 'warning' | 'error'> = {
    SKIPPED: 'default',
    PENDING: 'warning',
    OK: 'success',
    FAILED: 'error',
  }
  const Icon = status === 'OK' ? CloudDoneIcon : (status === 'FAILED' ? CloudOffIcon : null)
  return (
    <Chip
      size="small"
      color={colorMap[status]}
      variant={status === 'OK' ? 'filled' : 'outlined'}
      icon={Icon ? <Icon fontSize="small" /> : undefined}
      label={`${targetLabel(name)}: ${status}`}
      sx={{ mr: 0.5 }}
    />
  )
}

function StatusChip({ b }: { b: DeviceBackup }) {
  const colorMap: Record<DeviceBackup['status'], 'default' | 'info' | 'success' | 'error'> = {
    PENDING: 'default',
    UPLOADING: 'info',
    DISTRIBUTING: 'info',
    OK: 'success',
    FAILED: 'error',
  }
  return <Chip size="small" color={colorMap[b.status]} label={b.status} />
}

export function DeviceBackupCard({ deviceId, deviceOnline }: Props) {
  const { t } = useTranslation()
  const canUpdate = usePermission('devices:update')
  const { data: backups, isLoading } = useDeviceBackups(deviceId)
  const startBackup = useStartBackup(deviceId)
  const restoreBackup = useRestoreBackup(deviceId)
  const deleteBackup = useDeleteBackup(deviceId)
  const [restoreDlg, setRestoreDlg] = useState<{ backup: DeviceBackup; target: 'syno' | 'infomaniak' } | null>(null)
  const [deleteDlg, setDeleteDlg] = useState<DeviceBackup | null>(null)
  const [snack, setSnack] = useState<string | null>(null)

  const inflight = backups?.some((b) => b.status === 'PENDING' || b.status === 'UPLOADING' || b.status === 'DISTRIBUTING')

  const handleStart = async () => {
    try { await startBackup.mutateAsync(); setSnack(t('backup.started', 'Backup gestartet')) }
    catch (e) { setSnack(e instanceof Error ? e.message : String(e)) }
  }
  const handleRestore = async () => {
    if (!restoreDlg) return
    try {
      await restoreBackup.mutateAsync({ backupId: restoreDlg.backup.id, target: restoreDlg.target })
      setSnack(t('backup.restoreStarted', 'Wiederherstellung gestartet'))
    } catch (e) { setSnack(e instanceof Error ? e.message : String(e)) }
    finally { setRestoreDlg(null) }
  }
  const handleDelete = async () => {
    if (!deleteDlg) return
    try { await deleteBackup.mutateAsync(deleteDlg.id); setSnack(t('backup.deleted', 'Backup gelöscht')) }
    catch (e) { setSnack(e instanceof Error ? e.message : String(e)) }
    finally { setDeleteDlg(null) }
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">{t('backup.title', 'Backup')}</Typography>
          {canUpdate && (
            <Button
              variant="contained"
              size="small"
              startIcon={inflight ? <CircularProgress size={16} color="inherit" /> : <BackupIcon />}
              onClick={handleStart}
              disabled={!deviceOnline || inflight || startBackup.isPending}
            >
              {t('backup.start', 'Jetzt sichern')}
            </Button>
          )}
        </Box>
        {!deviceOnline && (
          <Typography variant="caption" color="text.secondary">{t('backup.deviceOffline', 'Gerät ist offline – Backups sind erst wieder möglich, sobald es online ist.')}</Typography>
        )}
        {isLoading ? (
          <Box display="flex" justifyContent="center" py={2}><CircularProgress size={24} /></Box>
        ) : (backups && backups.length > 0) ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('backup.col.created', 'Erstellt')}</TableCell>
                <TableCell>{t('backup.col.size', 'Grösse')}</TableCell>
                <TableCell>{t('backup.col.status', 'Status')}</TableCell>
                <TableCell>{t('backup.col.targets', 'Ziele')}</TableCell>
                <TableCell align="right">{t('backup.col.actions', 'Aktionen')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.id} hover>
                  <TableCell>{new Date(b.createdAt).toLocaleString('de-CH')}</TableCell>
                  <TableCell>{formatSize(b.sizeBytes)}</TableCell>
                  <TableCell>
                    <Tooltip title={b.errorMessage ?? ''}>
                      <span><StatusChip b={b} /></span>
                    </Tooltip>
                    {b.lastRestoreStatus && (
                      <Tooltip title={b.lastRestoreError ?? ''}>
                        <Chip
                          size="small"
                          color={b.lastRestoreStatus === 'OK' ? 'success' : (b.lastRestoreStatus === 'FAILED' ? 'error' : 'info')}
                          variant="outlined"
                          icon={<RestoreIcon fontSize="small" />}
                          label={`Restore: ${b.lastRestoreStatus}`}
                          sx={{ ml: 0.5 }}
                        />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <TargetBadge name="syno" status={b.synoStatus} />
                    <TargetBadge name="infomaniak" status={b.infomaniakStatus} />
                  </TableCell>
                  <TableCell align="right">
                    {canUpdate && b.synoStatus === 'OK' && (
                      <Tooltip title={t('backup.restoreFromSyno', 'Vom Syno NAS wiederherstellen')}>
                        <IconButton size="small" disabled={!deviceOnline} onClick={() => setRestoreDlg({ backup: b, target: 'syno' })}>
                          <RestoreIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {canUpdate && b.infomaniakStatus === 'OK' && (
                      <Tooltip title={t('backup.restoreFromInfomaniak', 'Von Infomaniak wiederherstellen')}>
                        <IconButton size="small" disabled={!deviceOnline} onClick={() => setRestoreDlg({ backup: b, target: 'infomaniak' })}>
                          <RestoreIcon fontSize="small" color="primary" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {canUpdate && (
                      <Tooltip title={t('backup.delete', 'Backup löschen')}>
                        <IconButton size="small" color="error" onClick={() => setDeleteDlg(b)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('backup.empty', 'Noch keine Backups vorhanden. Konfigurieren Sie ein Backup-Ziel in den globalen Einstellungen und klicken Sie auf «Jetzt sichern».')}
          </Typography>
        )}
      </CardContent>

      <Dialog open={!!restoreDlg} onClose={() => setRestoreDlg(null)}>
        <DialogTitle>{t('backup.restoreConfirmTitle', 'Backup wiederherstellen?')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('backup.restoreConfirmText', 'Die Visu wird gestoppt, die Daten werden ersetzt und die Visu wieder gestartet. Alle Änderungen seit diesem Backup gehen verloren.')}
          </DialogContentText>
          {restoreDlg && (
            <Box mt={2}>
              <Typography variant="body2"><b>{t('backup.col.created', 'Erstellt')}:</b> {new Date(restoreDlg.backup.createdAt).toLocaleString('de-CH')}</Typography>
              <Typography variant="body2"><b>{t('backup.source', 'Quelle')}:</b> {targetLabel(restoreDlg.target)}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreDlg(null)}>{t('common.cancel', 'Abbrechen')}</Button>
          <Button onClick={handleRestore} color="warning" variant="contained" startIcon={<RestoreIcon />}>
            {t('backup.restore', 'Wiederherstellen')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteDlg} onClose={() => setDeleteDlg(null)}>
        <DialogTitle>{t('backup.deleteConfirmTitle', 'Backup löschen?')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('backup.deleteConfirmText', 'Das Backup wird unwiderruflich von allen Backup-Zielen entfernt.')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDlg(null)}>{t('common.cancel', 'Abbrechen')}</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            {t('common.delete', 'Löschen')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)} message={snack} />
    </Card>
  )
}
