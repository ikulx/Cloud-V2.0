import { useState, useEffect } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Stepper from '@mui/material/Stepper'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import Snackbar from '@mui/material/Snackbar'
import FormGroup from '@mui/material/FormGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import { useTranslation } from 'react-i18next'
import { useCreateAnlage } from '../features/anlagen/queries'
import { SearchableMultiSelect } from './SearchableMultiSelect'
import { geocodeAddress } from '../lib/geocode'

interface Option { id: string; label: string }

interface Props {
  open: boolean
  onClose: () => void
  deviceOptions: Option[]
  userOptions: Option[]
  groupOptions: Option[]
  /** Vorab zugewiesene Geräte (z.B. wenn Wizard vom Geräte-Zuweisen-Dialog geöffnet wird) */
  initialDeviceIds?: string[]
  /** Callback nach erfolgreicher Erstellung – z.B. um Gerät zusätzlich zu registrieren */
  onCreated?: (anlageId: string) => Promise<void> | void
  /** Überschriebener Titel */
  title?: string
}

const EMPTY = {
  projectNumber: '', name: '', description: '',
  street: '', zip: '', city: '', country: 'Schweiz',
  latitude: '', longitude: '',
  hasHeatPump: false,
  hasBoiler: false,
  contactName: '', contactPhone: '', contactMobile: '', contactEmail: '',
  notes: '',
}
const EMPTY_ASSIGN = { deviceIds: [] as string[], userIds: [] as string[], groupIds: [] as string[] }

export function AnlageCreateWizard({
  open, onClose, deviceOptions, userOptions, groupOptions,
  initialDeviceIds, onCreated, title,
}: Props) {
  const { t } = useTranslation()
  const createMutation = useCreateAnlage()

  const [step, setStep] = useState(0)
  const [form, setForm] = useState(EMPTY)
  const [assign, setAssign] = useState<typeof EMPTY_ASSIGN>({
    ...EMPTY_ASSIGN,
    deviceIds: initialDeviceIds ?? [],
  })
  const [error, setError] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Bei Öffnen: Initial-Werte setzen (falls z.B. initialDeviceIds sich ändern)
  useEffect(() => {
    if (open) {
      setStep(0)
      setForm(EMPTY)
      setAssign({ ...EMPTY_ASSIGN, deviceIds: initialDeviceIds ?? [] })
      setError('')
    }
  }, [open, initialDeviceIds])

  const steps = [
    t('anlagen.wizardStepBasics'),
    t('anlagen.wizardStepAddress'),
    t('anlagen.wizardStepContact'),
    t('anlagen.wizardStepAssignments'),
    t('anlagen.wizardStepReview'),
  ]

  const reset = () => {
    setStep(0); setForm(EMPTY); setAssign(EMPTY_ASSIGN); setError('')
  }

  const handleClose = () => {
    if (createMutation.isPending) return
    reset()
    onClose()
  }

  const canGoNext = () => {
    // Step 0 erfordert mindestens einen Namen
    if (step === 0) return form.name.trim().length > 0
    return true
  }

  const handleNext = () => {
    if (step < steps.length - 1) setStep(step + 1)
  }
  const handleBack = () => {
    if (step > 0) setStep(step - 1)
  }

  const handleGeocode = async () => {
    setGeocoding(true)
    try {
      const result = await geocodeAddress({
        street: form.street, zip: form.zip, city: form.city, country: form.country,
      })
      if (result) {
        setForm({ ...form, latitude: result.latitude.toFixed(6), longitude: result.longitude.toFixed(6) })
      } else {
        setToast(t('anlagen.geocodeNotFound'))
      }
    } finally {
      setGeocoding(false)
    }
  }

  const handleSubmit = async () => {
    setError('')
    try {
      const { latitude: latStr, longitude: lngStr, ...rest } = form
      const latitude = latStr ? parseFloat(latStr) : null
      const longitude = lngStr ? parseFloat(lngStr) : null
      const created = await createMutation.mutateAsync({ ...rest, latitude, longitude, ...assign })
      const createdId = (created as { id?: string })?.id
      if (onCreated && createdId) {
        await onCreated(createdId)
      }
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>{title ?? t('anlagen.wizardTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}><StepLabel>{label}</StepLabel></Step>
          ))}
        </Stepper>

        {/* Step 0: Stammdaten */}
        {step === 0 && (
          <Stack spacing={2}>
            <TextField label="Projekt-Nr." value={form.projectNumber} onChange={(e) => setForm({ ...form, projectNumber: e.target.value })} fullWidth />
            <TextField label={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required autoFocus />
            <TextField label={t('common.description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={2} />
            <Box>
              <Typography variant="subtitle2" color="text.secondary" mb={0.5}>{t('anlagen.plantType')}</Typography>
              <FormGroup row>
                <FormControlLabel
                  control={<Checkbox checked={form.hasHeatPump} onChange={(e) => setForm({ ...form, hasHeatPump: e.target.checked })} />}
                  label={t('anlagen.plantTypeHeatPump')}
                />
                <FormControlLabel
                  control={<Checkbox checked={form.hasBoiler} onChange={(e) => setForm({ ...form, hasBoiler: e.target.checked })} />}
                  label={t('anlagen.plantTypeBoiler')}
                />
              </FormGroup>
            </Box>
          </Stack>
        )}

        {/* Step 1: Adresse */}
        {step === 1 && (
          <Stack spacing={2}>
            <TextField label="Strasse" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} fullWidth />
            <Box display="flex" gap={2}>
              <TextField label="PLZ" value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} sx={{ width: 140 }} />
              <TextField label="Ort" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} fullWidth />
            </Box>
            <TextField label="Land" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} fullWidth />
            <Button
              variant="outlined"
              size="small"
              startIcon={<MyLocationIcon />}
              onClick={handleGeocode}
              disabled={geocoding || (!form.street && !form.city && !form.zip)}
              sx={{ alignSelf: 'flex-start' }}
            >
              {geocoding ? '…' : t('anlagen.geocode')}
            </Button>
            <Box display="flex" gap={2}>
              <TextField label="Breitengrad" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} fullWidth placeholder="z.B. 47.3769" />
              <TextField label="Längengrad" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} fullWidth placeholder="z.B. 8.5417" />
            </Box>
          </Stack>
        )}

        {/* Step 2: Verantwortlicher */}
        {step === 2 && (
          <Stack spacing={2}>
            <TextField label="Name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} fullWidth />
            <TextField label="Telefon" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} fullWidth />
            <TextField label="Mobil" value={form.contactMobile} onChange={(e) => setForm({ ...form, contactMobile: e.target.value })} fullWidth />
            <TextField label="E-Mail" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} fullWidth type="email" />
          </Stack>
        )}

        {/* Step 3: Zuweisungen + Notizen */}
        {step === 3 && (
          <Stack spacing={3}>
            <SearchableMultiSelect
              label={t('nav.devices')}
              options={deviceOptions}
              selected={assign.deviceIds}
              onChange={(ids) => setAssign({ ...assign, deviceIds: ids })}
            />
            <Divider />
            <SearchableMultiSelect
              label={t('nav.users')}
              options={userOptions}
              selected={assign.userIds}
              onChange={(ids) => setAssign({ ...assign, userIds: ids })}
            />
            <Divider />
            <SearchableMultiSelect
              label={t('nav.groups')}
              options={groupOptions}
              selected={assign.groupIds}
              onChange={(ids) => setAssign({ ...assign, groupIds: ids })}
            />
            <Divider />
            <TextField label="Bemerkungen" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} fullWidth multiline rows={3} />
          </Stack>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <Stack spacing={2}>
            <Typography variant="h6">{t('anlagen.wizardSummary')}</Typography>

            <Box>
              <Typography variant="subtitle2" color="text.secondary">{t('anlagen.wizardStepBasics')}</Typography>
              <Stack spacing={0.5} mt={0.5}>
                {form.projectNumber && <Typography variant="body2"><strong>Projekt-Nr.:</strong> {form.projectNumber}</Typography>}
                <Typography variant="body2"><strong>{t('common.name')}:</strong> {form.name}</Typography>
                {form.description && <Typography variant="body2"><strong>{t('common.description')}:</strong> {form.description}</Typography>}
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                  <Typography variant="body2"><strong>{t('anlagen.plantType')}:</strong></Typography>
                  {form.hasHeatPump && <Chip size="small" label={t('anlagen.plantTypeHeatPump')} color="primary" />}
                  {form.hasBoiler && <Chip size="small" label={t('anlagen.plantTypeBoiler')} color="primary" />}
                  {!form.hasHeatPump && !form.hasBoiler && <Typography variant="body2" color="text.secondary">—</Typography>}
                </Box>
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="text.secondary">{t('anlagen.wizardStepAddress')}</Typography>
              <Typography variant="body2" mt={0.5}>
                {[form.street, [form.zip, form.city].filter(Boolean).join(' '), form.country].filter(Boolean).join(', ') || '—'}
              </Typography>
              {(form.latitude || form.longitude) && (
                <Typography variant="caption" color="text.secondary">
                  {form.latitude}, {form.longitude}
                </Typography>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="text.secondary">{t('anlagen.wizardStepContact')}</Typography>
              <Stack spacing={0.5} mt={0.5}>
                {form.contactName ? <Typography variant="body2">{form.contactName}</Typography> : <Typography variant="body2" color="text.secondary">—</Typography>}
                {form.contactPhone && <Typography variant="body2" color="text.secondary">{form.contactPhone}</Typography>}
                {form.contactMobile && <Typography variant="body2" color="text.secondary">{form.contactMobile}</Typography>}
                {form.contactEmail && <Typography variant="body2" color="text.secondary">{form.contactEmail}</Typography>}
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="text.secondary">{t('anlagen.wizardStepAssignments')}</Typography>
              <Stack spacing={0.5} mt={0.5}>
                <Typography variant="body2">{t('nav.devices')}: {assign.deviceIds.length}</Typography>
                <Typography variant="body2">{t('nav.users')}: {assign.userIds.length}</Typography>
                <Typography variant="body2">{t('nav.groups')}: {assign.groupIds.length}</Typography>
              </Stack>
            </Box>

            {form.notes && (
              <>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">Bemerkungen</Typography>
                  <Typography variant="body2" mt={0.5} sx={{ whiteSpace: 'pre-wrap' }}>{form.notes}</Typography>
                </Box>
              </>
            )}

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={createMutation.isPending}>{t('common.cancel')}</Button>
        <Box flexGrow={1} />
        {step > 0 && (
          <Button onClick={handleBack} disabled={createMutation.isPending}>{t('anlagen.wizardBack')}</Button>
        )}
        {step < steps.length - 1 ? (
          <Button variant="contained" onClick={handleNext} disabled={!canGoNext()}>
            {t('anlagen.wizardNext')}
          </Button>
        ) : (
          <Button variant="contained" onClick={handleSubmit} disabled={createMutation.isPending}>
            {t('anlagen.wizardFinish')}
          </Button>
        )}
      </DialogActions>

      <Snackbar
        open={!!toast}
        autoHideDuration={3500}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Dialog>
  )
}
