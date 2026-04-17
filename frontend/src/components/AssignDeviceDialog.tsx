import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Box from '@mui/material/Box'
import Autocomplete from '@mui/material/Autocomplete'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import AddIcon from '@mui/icons-material/Add'
import WarningIcon from '@mui/icons-material/Warning'
import { useTranslation } from 'react-i18next'
import { useUpdateDevice, useApproveDevice } from '../features/devices/queries'
import { AnlageCreateWizard } from './AnlageCreateWizard'
import type { Anlage, Device } from '../types/model'

interface Props {
  open: boolean
  onClose: () => void
  device: Device | null
  anlagen: Anlage[]
  /** Wenn true: zusätzlich zum Zuweisen auch registrieren (für nicht-registrierte Geräte) */
  alsoRegister: boolean
}

export function AssignDeviceDialog({ open, onClose, device, anlagen, alsoRegister }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState(0)  // 0 = neu (Wizard), 1 = bestehend
  const [existingAnlage, setExistingAnlage] = useState<Anlage | null>(null)
  const [error, setError] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  const updateDevice = useUpdateDevice(device?.id ?? '')
  const approveDevice = useApproveDevice()

  const pending = updateDevice.isPending || approveDevice.isPending

  const reset = () => {
    setTab(0); setExistingAnlage(null); setError(''); setConfirmed(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleAssignExisting = async () => {
    if (!device || !existingAnlage) { setError(t('common.fieldRequired', 'Anlage wählen')); return }
    setError('')
    try {
      if (alsoRegister && !device.isApproved) {
        await approveDevice.mutateAsync({ id: device.id, isApproved: true })
      }
      const currentAnlageIds = device.anlageDevices.map((ad) => ad.anlage.id)
      const newAnlageIds = Array.from(new Set([...currentAnlageIds, existingAnlage.id]))
      await updateDevice.mutateAsync({ anlageIds: newAnlageIds })
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  // Callback vom Wizard – wird nach erfolgreichem Erstellen aufgerufen.
  // Gerät wurde bereits im Wizard via deviceIds zugewiesen; wir müssen nur noch
  // registrieren, falls nötig.
  const handleWizardCreated = async () => {
    if (!device) return
    if (alsoRegister && !device.isApproved) {
      await approveDevice.mutateAsync({ id: device.id, isApproved: true })
    }
    setWizardOpen(false)
    handleClose()
  }

  if (!device) return null

  return (
    <>
      <Dialog open={open && !wizardOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('anlagen.assignDevice')}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" icon={<WarningIcon />} sx={{ mb: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>
              {alsoRegister
                ? t('devices.confirmRegisterAssign', 'Ist das wirklich das richtige Gerät? Es wird registriert und zugewiesen.')
                : t('devices.confirmAssign', 'Ist das wirklich das richtige Gerät? Es wird zugewiesen.')}
            </AlertTitle>
            <Box display="flex" alignItems="center" gap={1} mt={1}>
              <Typography variant="caption">{t('devices.serialNumber')}:</Typography>
              <Chip label={device.serialNumber} size="small" color="error"
                sx={{ fontFamily: 'monospace', fontWeight: 700 }} />
            </Box>
            {device.piSerial && (
              <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                <Typography variant="caption">Pi-Serial:</Typography>
                <Chip label={device.piSerial} size="small" color="error" variant="outlined"
                  sx={{ fontFamily: 'monospace' }} />
              </Box>
            )}
            <FormControlLabel
              sx={{ mt: 1.5, display: 'flex' }}
              control={
                <Checkbox
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  color="error"
                />
              }
              label={
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('devices.confirmCheckbox', 'Ich bestätige: Das ist das richtige Gerät')}
                </Typography>
              }
            />
          </Alert>

          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab label={t('anlagen.assignToNew')} />
            <Tab label={t('anlagen.assignToExisting')} />
          </Tabs>

          {tab === 0 && (
            <Box display="flex" flexDirection="column" gap={2} pt={1} alignItems="center" py={3}>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                {t('anlagen.wizardTitle')} – {t('anlagen.wizardStepBasics')}, {t('anlagen.wizardStepAddress')}, {t('anlagen.wizardStepContact')}…
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setWizardOpen(true)}
                disabled={!confirmed}
              >
                {t('anlagen.wizardTitle')}
              </Button>
              <Typography variant="caption" color="text.secondary" textAlign="center">
                {alsoRegister
                  ? t('devices.wizardHintRegister', 'Das Gerät wird nach der Erstellung registriert und zugewiesen.')
                  : t('devices.wizardHintAssign', 'Das Gerät wird der neuen Anlage zugewiesen.')}
              </Typography>
            </Box>
          )}

          {tab === 1 && (
            <Box pt={1}>
              <Autocomplete
                options={anlagen}
                value={existingAnlage}
                onChange={(_, v) => setExistingAnlage(v)}
                getOptionLabel={(a) => a.projectNumber ? `${a.projectNumber} – ${a.name}` : a.name}
                renderInput={(params) => <TextField {...params} label={t('nav.anlagen')} autoFocus />}
                fullWidth
              />
            </Box>
          )}

          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={pending}>{t('common.cancel')}</Button>
          {tab === 1 && (
            <Button
              variant="contained"
              color="error"
              onClick={handleAssignExisting}
              disabled={pending || !existingAnlage || !confirmed}
            >
              {alsoRegister ? t('devices.register') : t('common.confirm')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Wizard für neue Anlage – mit Device vorausgewählt */}
      <AnlageCreateWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        initialDeviceIds={[device.id]}
        onCreated={handleWizardCreated}
      />
    </>
  )
}
