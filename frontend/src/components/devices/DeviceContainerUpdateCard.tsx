import { useMemo, useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt'
import { useTranslation } from 'react-i18next'
import { useDockerHubTags, useContainerUpdate } from '../../features/devices/queries'
import { usePermission } from '../../hooks/usePermission'

interface Props {
  deviceId: string
  deviceOnline: boolean
  /** Aktuelle Visu-Version vom Tele (z.B. "y-vis3:v0.0.2-rc7"). */
  visuVersion: string | null
}

// Default-Repo für den Visu-Service. Falls jemand ein anderes Image nutzt,
// kann er über das "Eigenes Image"-Feld einen komplett eigenen Tag eintragen.
const DEFAULT_REPO = 'ikulx/y-vis3'
const DEFAULT_SERVICE = 'ycontrol-rt-v3'

export function DeviceContainerUpdateCard({ deviceId, deviceOnline, visuVersion }: Props) {
  const { t } = useTranslation()
  const canUpdate = usePermission('devices:update')
  const [repo, setRepo] = useState(DEFAULT_REPO)
  const [selectedTag, setSelectedTag] = useState<string>('')
  const [customImage, setCustomImage] = useState<string>('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [snack, setSnack] = useState<string | null>(null)
  const tags = useDockerHubTags(repo)
  const containerUpdate = useContainerUpdate(deviceId)

  // Aktueller Tag vom Tele extrahieren (z.B. "y-vis3:v0.0.2-rc7" → "v0.0.2-rc7")
  const currentTag = useMemo(() => {
    if (!visuVersion) return null
    const idx = visuVersion.lastIndexOf(':')
    return idx >= 0 ? visuVersion.slice(idx + 1) : visuVersion
  }, [visuVersion])

  const targetImage = customImage.trim() || (selectedTag ? `${repo}:${selectedTag}` : '')
  const isSameAsCurrent = useMemo(() => {
    if (!currentTag || !selectedTag || customImage.trim()) return false
    return selectedTag === currentTag
  }, [currentTag, selectedTag, customImage])

  const handleConfirm = async () => {
    if (!targetImage) return
    try {
      await containerUpdate.mutateAsync({ image: targetImage, service: DEFAULT_SERVICE })
      setSnack(t('containerUpdate.started', 'Update gestartet – die Visu lädt das neue Image und wird gleich neu gestartet.'))
      setConfirmOpen(false)
      setCustomImage('')
      setSelectedTag('')
    } catch (e) {
      setSnack(e instanceof Error ? e.message : String(e))
    }
  }

  if (!canUpdate) return null

  return (
    <Card>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1} flexWrap="wrap">
          <Typography variant="h6">{t('containerUpdate.title', 'Visu-Update')}</Typography>
          {currentTag && (
            <Chip size="small" label={`${t('containerUpdate.current', 'Aktuell')}: ${currentTag}`} />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('containerUpdate.intro', 'Zieht ein anderes Visu-Image von DockerHub ({{repo}}) und startet den Container neu. Die Benutzer sehen während des Updates ein Vollbild-Overlay.', { repo })}
        </Typography>

        <Box display="flex" gap={1} alignItems="flex-start" flexWrap="wrap">
          <TextField
            size="small"
            label={t('containerUpdate.repo', 'DockerHub-Repo')}
            value={repo}
            onChange={(e) => { setRepo(e.target.value); setSelectedTag('') }}
            sx={{ minWidth: 220 }}
          />
          <TextField
            select
            size="small"
            label={t('containerUpdate.tag', 'Tag')}
            value={selectedTag}
            onChange={(e) => { setSelectedTag(e.target.value); setCustomImage('') }}
            disabled={tags.isLoading || !tags.data?.length}
            sx={{ minWidth: 220 }}
            helperText={tags.isError ? (tags.error instanceof Error ? tags.error.message : String(tags.error)) : ' '}
            error={tags.isError}
          >
            {tags.isLoading && <MenuItem value=""><em>{t('common.loading', 'Lädt...')}</em></MenuItem>}
            {tags.data?.map((tag) => (
              <MenuItem key={tag.name} value={tag.name}>
                {tag.name}
                {tag.name === currentTag && <Chip size="small" label={t('containerUpdate.currentTag', 'aktuell')} sx={{ ml: 1 }} />}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box mt={2}>
          <TextField
            size="small"
            fullWidth
            label={t('containerUpdate.custom', 'oder: komplettes Image (repo:tag)')}
            placeholder="ikulx/y-vis3:v0.0.2-rc8"
            value={customImage}
            onChange={(e) => { setCustomImage(e.target.value); setSelectedTag('') }}
            helperText={t('containerUpdate.customHint', 'Überschreibt die obige Auswahl falls ausgefüllt')}
          />
        </Box>

        <Box mt={2} display="flex" justifyContent="flex-end">
          <Button
            variant="contained"
            startIcon={containerUpdate.isPending ? <CircularProgress size={16} color="inherit" /> : <SystemUpdateAltIcon />}
            disabled={!deviceOnline || !targetImage || isSameAsCurrent || containerUpdate.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {t('containerUpdate.start', 'Update starten')}
          </Button>
        </Box>

        {isSameAsCurrent && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('containerUpdate.sameVersion', 'Dieser Tag läuft bereits auf dem Gerät.')}
          </Alert>
        )}

        {!deviceOnline && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('containerUpdate.offline', 'Gerät ist offline – Updates sind erst wieder möglich, sobald es online ist.')}
          </Typography>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{t('containerUpdate.confirmTitle', 'Visu aktualisieren?')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('containerUpdate.confirmText', 'Das Gerät lädt jetzt das neue Image und startet den Container neu. Der laufende Betrieb wird während des Updates (~30–60 Sekunden) unterbrochen. Alle Nutzer sehen ein Overlay und werden nach dem Update automatisch auf die neue Version geleitet.')}
          </DialogContentText>
          <Box mt={2}>
            <Typography variant="body2"><b>{t('containerUpdate.current', 'Aktuell')}:</b> {currentTag || '—'}</Typography>
            <Typography variant="body2"><b>{t('containerUpdate.new', 'Neu')}:</b> {targetImage}</Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel', 'Abbrechen')}</Button>
          <Button onClick={handleConfirm} color="warning" variant="contained" startIcon={<SystemUpdateAltIcon />} disabled={containerUpdate.isPending}>
            {t('containerUpdate.start', 'Update starten')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={6000} onClose={() => setSnack(null)} message={snack} />
    </Card>
  )
}
