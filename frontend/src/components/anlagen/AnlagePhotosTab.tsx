import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import { apiGet, apiPost, apiDelete } from '../../lib/api'
import type { AnlagePhoto } from '../../types/model'
import { usePermission } from '../../hooks/usePermission'
import { PhotoUploadField } from './PhotoUploadField'

interface Props {
  anlageId: string
}

/**
 * Zeigt alle Fotos einer Anlage als Galerie-Raster an:
 * - Standalone-Fotos (vom Photos-Tab hochgeladen) – löschbar wenn User
 *   das Recht anlagen:update hat.
 * - Fotos aus Anlage-Todos und Log-Einträgen – nur anzeigen, Edit erfolgt
 *   am jeweiligen Todo/Log.
 */
export function AnlagePhotosTab({ anlageId }: Props) {
  const qc = useQueryClient()
  const canEdit = usePermission('anlagen:update')
  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['anlagen', anlageId, 'photos'] as const,
    queryFn: () => apiGet<AnlagePhoto[]>(`/anlagen/${anlageId}/photos`),
  })
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pending, setPending] = useState<string[]>([])
  const [caption, setCaption] = useState('')
  const [uploadError, setUploadError] = useState<string | null>(null)

  const saveStandalonePhoto = useMutation({
    mutationFn: (data: { url: string; caption: string | null }) =>
      apiPost(`/anlagen/${anlageId}/photos`, data),
  })
  const deleteStandalonePhoto = useMutation({
    mutationFn: (photoId: string) => apiDelete(`/anlagen/${anlageId}/photos/${photoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['anlagen', anlageId, 'photos'] }),
  })

  const handleFinishUpload = async () => {
    setUploadError(null)
    try {
      // Pro hochgeladener Datei einen AnlagePhoto-Record mit (geteilter) Caption anlegen.
      for (const url of pending) {
        await saveStandalonePhoto.mutateAsync({ url, caption: caption.trim() || null })
      }
      await qc.invalidateQueries({ queryKey: ['anlagen', anlageId, 'photos'] })
      setUploadOpen(false)
      setPending([])
      setCaption('')
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDelete = async (photoId: string) => {
    if (!window.confirm('Foto wirklich löschen?')) return
    try { await deleteStandalonePhoto.mutateAsync(photoId) }
    catch (e) { alert(e instanceof Error ? e.message : String(e)) }
  }

  if (isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          {photos.length === 0
            ? 'Noch keine Fotos vorhanden.'
            : `${photos.length} Foto${photos.length === 1 ? '' : 's'} – Klick zum Vergrössern.`}
        </Typography>
        {canEdit && (
          <Button
            variant="contained"
            size="small"
            startIcon={<AddPhotoAlternateIcon />}
            onClick={() => setUploadOpen(true)}
          >
            Fotos hinzufügen
          </Button>
        )}
      </Box>

      {photos.length > 0 && (
      <Box sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(5, 1fr)' },
      }}>
        {photos.map((p, idx) => (
          <Box
            key={`${p.url}-${idx}`}
            sx={{
              position: 'relative',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
              bgcolor: 'background.paper',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Box
              onClick={() => setZoomUrl(p.url)}
              sx={{
                aspectRatio: '4 / 3',
                cursor: 'zoom-in',
                backgroundImage: `url(${p.url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
            {canEdit && p.source === 'photo' && p.id && (
              <Tooltip title="Foto löschen">
                <IconButton
                  size="small"
                  onClick={() => handleDelete(p.id!)}
                  sx={{
                    position: 'absolute', top: 4, right: 4,
                    bgcolor: 'rgba(0,0,0,0.55)', color: '#fff',
                    '&:hover': { bgcolor: 'rgba(180,0,0,0.85)' },
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Box sx={{ p: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <Chip
                  size="small"
                  label={p.source === 'todo' ? 'Todo' : p.source === 'log' ? 'Logbuch' : 'Foto'}
                  color={p.source === 'todo' ? 'warning' : p.source === 'log' ? 'info' : 'success'}
                  sx={{ height: 18, fontSize: 10 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {new Date(p.createdAt).toLocaleDateString('de-CH')}
                </Typography>
              </Box>
              {p.caption && (
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  title={p.caption}
                >
                  {p.caption}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {p.createdBy.firstName} {p.createdBy.lastName}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
      )}

      {/* Upload-Dialog */}
      <Dialog
        open={uploadOpen}
        onClose={() => { if (!saveStandalonePhoto.isPending) { setUploadOpen(false); setPending([]); setCaption(''); setUploadError(null) } }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Fotos hinzufügen</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <PhotoUploadField
              value={pending}
              onChange={setPending}
              disabled={saveStandalonePhoto.isPending}
              label="Fotos"
            />
            <TextField
              label="Beschreibung (optional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              fullWidth
              multiline
              maxRows={3}
              placeholder="Wird allen gerade hochgeladenen Fotos als Beschriftung mitgegeben."
              disabled={saveStandalonePhoto.isPending}
            />
            {uploadError && <Alert severity="error">{uploadError}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setUploadOpen(false); setPending([]); setCaption('') }} disabled={saveStandalonePhoto.isPending}>
            Abbrechen
          </Button>
          <Button
            onClick={handleFinishUpload}
            variant="contained"
            disabled={pending.length === 0 || saveStandalonePhoto.isPending}
          >
            {saveStandalonePhoto.isPending
              ? `Speichere (${pending.length})...`
              : pending.length > 0
                ? `${pending.length} Foto${pending.length === 1 ? '' : 's'} speichern`
                : 'Speichern'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Zoom-Dialog */}
      <Dialog
        open={Boolean(zoomUrl)}
        onClose={() => setZoomUrl(null)}
        maxWidth="lg"
        fullWidth
      >
        <DialogContent sx={{ p: 0, position: 'relative', bgcolor: '#000' }}>
          <IconButton
            onClick={() => setZoomUrl(null)}
            sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(0,0,0,0.55)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' } }}
          >
            <CloseIcon />
          </IconButton>
          {zoomUrl && (
            <Box
              component="img"
              src={zoomUrl}
              alt=""
              sx={{ width: '100%', maxHeight: '90vh', objectFit: 'contain', display: 'block' }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  )
}
