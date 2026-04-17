import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Alert from '@mui/material/Alert'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Box from '@mui/material/Box'
import Autocomplete from '@mui/material/Autocomplete'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import { useTranslation } from 'react-i18next'
import { useCreateAnlage } from '../features/anlagen/queries'
import { useUpdateDevice, useApproveDevice } from '../features/devices/queries'
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
  const [tab, setTab] = useState(0)  // 0 = neu, 1 = bestehend
  const [newName, setNewName] = useState('')
  const [newPlantType, setNewPlantType] = useState<'' | 'HEAT_PUMP' | 'BOILER'>('')
  const [existingAnlage, setExistingAnlage] = useState<Anlage | null>(null)
  const [error, setError] = useState('')

  const createAnlage = useCreateAnlage()
  const updateDevice = useUpdateDevice(device?.id ?? '')
  const approveDevice = useApproveDevice()

  const pending = createAnlage.isPending || updateDevice.isPending || approveDevice.isPending

  const reset = () => {
    setTab(0); setNewName(''); setNewPlantType(''); setExistingAnlage(null); setError('')
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleConfirm = async () => {
    if (!device) return
    setError('')
    try {
      let anlageId: string
      if (tab === 0) {
        // Neue Anlage erstellen
        if (!newName.trim()) { setError(t('common.fieldRequired', 'Name erforderlich')); return }
        const created = await createAnlage.mutateAsync({
          name: newName.trim(),
          plantType: newPlantType || null,
          country: 'Schweiz',
        })
        anlageId = (created as { id: string }).id
      } else {
        // Bestehender Anlage zuweisen
        if (!existingAnlage) { setError(t('common.fieldRequired', 'Anlage wählen')); return }
        anlageId = existingAnlage.id
      }

      // Gerät registrieren (wenn noch nicht) und zuweisen
      if (alsoRegister && !device.isApproved) {
        await approveDevice.mutateAsync({ id: device.id, isApproved: true })
      }

      // Zuweisung: aktuelle anlageIds + neue
      const currentAnlageIds = device.anlageDevices.map((ad) => ad.anlage.id)
      const newAnlageIds = Array.from(new Set([...currentAnlageIds, anlageId]))
      await updateDevice.mutateAsync({ anlageIds: newAnlageIds })

      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  if (!device) return null

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('anlagen.assignDevice')}</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" gutterBottom>
            {alsoRegister
              ? t('devices.confirmRegisterAssign', 'Ist das wirklich das richtige Gerät? Es wird registriert und zugewiesen.')
              : t('devices.confirmAssign', 'Ist das wirklich das richtige Gerät? Es wird zugewiesen.')}
          </Typography>
          <Box display="flex" alignItems="center" gap={1} mt={1}>
            <Typography variant="caption" color="text.secondary">{t('devices.serialNumber')}:</Typography>
            <Chip label={device.serialNumber} size="small" sx={{ fontFamily: 'monospace', fontWeight: 600 }} />
          </Box>
          {device.piSerial && (
            <Box display="flex" alignItems="center" gap={1} mt={0.5}>
              <Typography variant="caption" color="text.secondary">Pi-Serial:</Typography>
              <Chip label={device.piSerial} size="small" sx={{ fontFamily: 'monospace' }} variant="outlined" />
            </Box>
          )}
        </Alert>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('anlagen.assignToNew')} />
          <Tab label={t('anlagen.assignToExisting')} />
        </Tabs>

        {tab === 0 && (
          <Box display="flex" flexDirection="column" gap={2} pt={1}>
            <TextField
              label={t('common.name')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              fullWidth
              required
              autoFocus
            />
            <TextField
              label={t('anlagen.plantType')}
              select
              value={newPlantType}
              onChange={(e) => setNewPlantType(e.target.value as '' | 'HEAT_PUMP' | 'BOILER')}
              fullWidth
            >
              <MenuItem value="">—</MenuItem>
              <MenuItem value="HEAT_PUMP">{t('anlagen.plantTypeHeatPump')}</MenuItem>
              <MenuItem value="BOILER">{t('anlagen.plantTypeBoiler')}</MenuItem>
            </TextField>
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
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={pending || (tab === 0 ? !newName.trim() : !existingAnlage)}
        >
          {alsoRegister ? t('devices.register') : t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
