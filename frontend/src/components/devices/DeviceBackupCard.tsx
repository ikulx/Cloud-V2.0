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
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Divider from '@mui/material/Divider'
import Alert from '@mui/material/Alert'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import {
  useDeviceBackups,
  useStartBackup,
  useRestoreBackup,
  useDeleteBackup,
  useCrossDeviceBackupSources,
  usePinBackup,
  useUnpinBackup,
  type DeviceBackup,
  type BackupTargetStatus,
  type CrossDeviceBackupSource,
} from '../../features/backups/queries'
import { useUpdateDevice } from '../../features/devices/queries'
import { usePermission } from '../../hooks/usePermission'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import ScheduleIcon from '@mui/icons-material/Schedule'
import AutoModeIcon from '@mui/icons-material/AutoMode'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'

interface Props {
  deviceId: string
  deviceOnline: boolean
  /** Pro-Gerät-Schalter für Auto-Backup; wenn nicht gesetzt wird der Switch nicht angezeigt. */
  autoBackupEnabled?: boolean
}

function formatSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function TargetBadge({ status }: { status: BackupTargetStatus }) {
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
      label={`${status}`}
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

export function DeviceBackupCard({ deviceId, deviceOnline, autoBackupEnabled }: Props) {
  const { t } = useTranslation()
  const canUpdate = usePermission('devices:update')
  const canCrossRestore = usePermission('backups:restore_cross_device')
  const { data: backups, isLoading } = useDeviceBackups(deviceId)
  const startBackup = useStartBackup(deviceId)
  const restoreBackup = useRestoreBackup(deviceId)
  const deleteBackup = useDeleteBackup(deviceId)
  const pinBackup = usePinBackup(deviceId)
  const unpinBackup = useUnpinBackup(deviceId)
  const updateDevice = useUpdateDevice(deviceId)
  const [restoreDlg, setRestoreDlg] = useState<{ backup: { id: string; createdAt: string; sourceDeviceName?: string | null } ; target: 'infomaniak'; crossDevice?: boolean } | null>(null)
  const [deleteDlg, setDeleteDlg] = useState<DeviceBackup | null>(null)
  const [crossDlgOpen, setCrossDlgOpen] = useState(false)
  const [crossSearch, setCrossSearch] = useState('')
  const crossSources = useCrossDeviceBackupSources(crossDlgOpen && canCrossRestore)
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
  const handleTogglePin = async (b: DeviceBackup) => {
    try {
      if (b.isPinned) { await unpinBackup.mutateAsync(b.id); setSnack(t('backup.unpinned', 'Fixierung aufgehoben')) }
      else { await pinBackup.mutateAsync(b.id); setSnack(t('backup.pinned', 'Backup fixiert – wird von Retention ignoriert')) }
    } catch (e) { setSnack(e instanceof Error ? e.message : String(e)) }
  }
  const handleToggleAutoBackup = async (checked: boolean) => {
    try { await updateDevice.mutateAsync({ autoBackupEnabled: checked }) }
    catch (e) { setSnack(e instanceof Error ? e.message : String(e)) }
  }

  // Pro Gerät darf genau ein Backup pinned sein → für User-Feedback wissen wir
  // ob es schon eines gibt (dann warnen wir beim Pinnen eines zweiten).
  const existingPinned = backups?.find((b) => b.isPinned)

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1} flexWrap="wrap">
          <Typography variant="h6">{t('backup.title', 'Backup')}</Typography>
          <Box display="flex" gap={1} flexWrap="wrap">
            {canCrossRestore && (
              <Tooltip title={t('backup.crossDeviceHint', 'Backup eines anderen Geräts auf dieses Gerät einspielen')}>
                <span>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SwapHorizIcon />}
                    onClick={() => setCrossDlgOpen(true)}
                    disabled={!deviceOnline}
                  >
                    {t('backup.crossDevice', 'Von anderem Gerät')}
                  </Button>
                </span>
              </Tooltip>
            )}
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
        </Box>
        {/* Auto-Backup-Switch pro Gerät. Greift nur wenn globaler Master-Switch auch an ist. */}
        {canUpdate && autoBackupEnabled !== undefined && (
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={autoBackupEnabled}
                  onChange={(e) => handleToggleAutoBackup(e.target.checked)}
                  disabled={updateDevice.isPending}
                />
              }
              label={
                <Box display="flex" alignItems="center" gap={0.5}>
                  <ScheduleIcon fontSize="small" color="action" />
                  <Typography variant="body2">{t('backup.autoLabel', 'Automatisches Backup nach Inaktivität')}</Typography>
                </Box>
              }
            />
            <Tooltip title={t('backup.autoHint', 'Cloud erstellt automatisch ein Backup wenn seit der letzten Config-Änderung das globale Intervall (Standard 24h) abgelaufen ist. Master-Switch steht in den globalen Einstellungen.')}>
              <Typography variant="caption" color="text.secondary">ⓘ</Typography>
            </Tooltip>
          </Box>
        )}
        {existingPinned && !backups?.find((b) => b.isPinned && b.id === existingPinned.id) && null}
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
                <TableCell>{t('backup.col.target', 'Ziel')}</TableCell>
                <TableCell align="right">{t('backup.col.actions', 'Aktionen')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.id} hover sx={b.isPinned ? { backgroundColor: (theme) => theme.palette.action.hover } : undefined}>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={0.5}>
                      {new Date(b.createdAt).toLocaleString('de-CH')}
                      {b.trigger === 'auto' && (
                        <Tooltip title={t('backup.triggerAuto', 'Automatisch nach Inaktivität erstellt')}>
                          <AutoModeIcon fontSize="small" color="action" />
                        </Tooltip>
                      )}
                      {b.isPinned && (
                        <Tooltip title={t('backup.pinnedHint', 'Fixiert – wird nicht automatisch gelöscht')}>
                          <PushPinIcon fontSize="small" sx={{ color: 'warning.main' }} />
                        </Tooltip>
                      )}
                    </Box>
                  </TableCell>
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
                    <TargetBadge status={b.infomaniakStatus} />
                  </TableCell>
                  <TableCell align="right">
                    {canUpdate && b.status === 'OK' && (
                      <Tooltip title={b.isPinned ? t('backup.unpin', 'Fixierung aufheben') : t('backup.pin', 'Backup fixieren (nicht auto-löschen)')}>
                        <IconButton size="small" onClick={() => handleTogglePin(b)} disabled={pinBackup.isPending || unpinBackup.isPending}>
                          {b.isPinned
                            ? <PushPinIcon fontSize="small" sx={{ color: 'warning.main' }} />
                            : <PushPinOutlinedIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    )}
                    {canUpdate && b.infomaniakStatus === 'OK' && (
                      <Tooltip title={t('backup.restore', 'Wiederherstellen')}>
                        <IconButton size="small" disabled={!deviceOnline} onClick={() => setRestoreDlg({ backup: b, target: 'infomaniak' })}>
                          <RestoreIcon fontSize="small" color="primary" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {canUpdate && (
                      <Tooltip title={b.isPinned ? t('backup.deletePinnedDisabled', 'Pinned Backup kann nicht gelöscht werden – erst Fixierung aufheben') : t('backup.delete', 'Backup löschen')}>
                        <span>
                          <IconButton size="small" color="error" onClick={() => setDeleteDlg(b)} disabled={b.isPinned}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
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
              <Typography variant="body2"><b>{t('backup.source', 'Quelle')}:</b> Infomaniak Swiss Backup</Typography>
              {restoreDlg.crossDevice && restoreDlg.backup.sourceDeviceName && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {t('backup.crossDeviceWarning', 'Dieses Backup stammt von einem ANDEREN Gerät ({{name}}). Die aktuelle Konfiguration dieses Geräts wird komplett durch die Daten des Quell-Geräts ersetzt.', { name: restoreDlg.backup.sourceDeviceName })}
                </Alert>
              )}
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

      <Dialog
        open={crossDlgOpen}
        onClose={() => { setCrossDlgOpen(false); setCrossSearch('') }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('backup.crossDeviceTitle', 'Backup eines anderen Geräts einspielen')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('backup.crossDeviceIntro', 'Wähle ein Backup aus einem anderen Gerät aus. Die Daten werden auf DIESES Gerät übertragen und überschreiben dort die aktuelle Konfiguration.')}
          </DialogContentText>

          {/* Suchfeld: filtert nach Gerätename, Seriennummer oder formatiertem Datum. */}
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder={t('backup.crossDeviceSearch', 'Suchen nach Gerät, Seriennummer oder Datum...')}
            value={crossSearch}
            onChange={(e) => setCrossSearch(e.target.value)}
            sx={{ mt: 2 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                ),
                endAdornment: crossSearch ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setCrossSearch('')} aria-label={t('common.clear', 'Zurücksetzen')}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
          />

          {crossSources.isLoading ? (
            <Box display="flex" justifyContent="center" py={3}><CircularProgress size={24} /></Box>
          ) : crossSources.isError ? (
            <Alert severity="error" sx={{ mt: 2 }}>{crossSources.error instanceof Error ? crossSources.error.message : String(crossSources.error)}</Alert>
          ) : (() => {
            const allRows = (crossSources.data ?? []).filter((s: CrossDeviceBackupSource) => s.deviceId !== deviceId)
            if (allRows.length === 0) {
              return <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{t('backup.crossDeviceEmpty', 'Keine verfügbaren Backups von anderen Geräten gefunden.')}</Typography>
            }
            // Suche gegen Gerätename + Seriennummer + formatiertes Datum prüfen.
            const needle = crossSearch.trim().toLowerCase()
            const rows = needle
              ? allRows.filter((s) => {
                  const haystack = [
                    s.deviceName || '',
                    s.deviceSerial || '',
                    new Date(s.createdAt).toLocaleString('de-CH'),
                    new Date(s.createdAt).toLocaleDateString('de-CH'),
                  ].join(' ').toLowerCase()
                  return haystack.includes(needle)
                })
              : allRows
            if (rows.length === 0) {
              return (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  {t('backup.crossDeviceNoMatch', 'Keine Treffer für «{{q}}».', { q: crossSearch })}
                </Typography>
              )
            }
            const grouped = new Map<string, CrossDeviceBackupSource[]>()
            rows.forEach((s) => {
              const k = s.deviceId
              if (!grouped.has(k)) grouped.set(k, [])
              grouped.get(k)!.push(s)
            })
            return (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                  {t('backup.crossDeviceCount', '{{count}} Backup(s) auf {{devices}} Gerät(en)', { count: rows.length, devices: grouped.size })}
                </Typography>
                <List dense sx={{ mt: 0.5, maxHeight: '50vh', overflowY: 'auto' }}>
                  {Array.from(grouped.entries()).map(([devId, items], idx) => (
                    <Box key={devId}>
                      {idx > 0 && <Divider sx={{ my: 1 }} />}
                      <Typography variant="subtitle2" sx={{ px: 2, py: 1 }}>
                        {items[0].deviceName || items[0].deviceSerial || devId}
                        {items[0].deviceName && items[0].deviceSerial && (
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{items[0].deviceSerial}</Typography>
                        )}
                      </Typography>
                      {items.map((s) => (
                        <ListItemButton
                          key={s.id}
                          onClick={() => {
                            setCrossDlgOpen(false)
                            setCrossSearch('')
                            setRestoreDlg({
                              backup: { id: s.id, createdAt: s.createdAt, sourceDeviceName: s.deviceName || s.deviceSerial },
                              target: 'infomaniak',
                              crossDevice: true,
                            })
                          }}
                        >
                          <ListItemText
                            primary={new Date(s.createdAt).toLocaleString('de-CH')}
                            secondary={formatSize(s.sizeBytes)}
                          />
                        </ListItemButton>
                      ))}
                    </Box>
                  ))}
                </List>
              </>
            )
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCrossDlgOpen(false); setCrossSearch('') }}>{t('common.close', 'Schliessen')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)} message={snack} />
    </Card>
  )
}
