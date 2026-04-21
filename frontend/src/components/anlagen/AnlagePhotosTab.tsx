import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import { apiGet } from '../../lib/api'
import type { AnlagePhoto } from '../../types/model'

interface Props {
  anlageId: string
}

/**
 * Zeigt alle Fotos einer Anlage als Galerie-Raster an.
 * Quelle (Todo oder Log) wird als Chip markiert, die Bildunterschrift ist
 * der Titel des Todos bzw. die Message des Log-Eintrags.
 */
export function AnlagePhotosTab({ anlageId }: Props) {
  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['anlagen', anlageId, 'photos'] as const,
    queryFn: () => apiGet<AnlagePhoto[]>(`/anlagen/${anlageId}/photos`),
  })
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  if (isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
  }

  if (photos.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        Noch keine Fotos in Todos oder Logbuch-Einträgen vorhanden.
      </Typography>
    )
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {photos.length} Foto{photos.length === 1 ? '' : 's'} aus Todos und Logbuch-Einträgen.
        Klick auf ein Bild zum Vergrössern.
      </Typography>

      <Box sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)', lg: 'repeat(5, 1fr)' },
      }}>
        {photos.map((p, idx) => (
          <Box
            key={`${p.url}-${idx}`}
            sx={{
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
            <Box sx={{ p: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                <Chip
                  size="small"
                  label={p.source === 'todo' ? 'Todo' : 'Logbuch'}
                  color={p.source === 'todo' ? 'warning' : 'info'}
                  sx={{ height: 18, fontSize: 10 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {new Date(p.createdAt).toLocaleDateString('de-CH')}
                </Typography>
              </Box>
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
              <Typography variant="caption" color="text.secondary">
                {p.createdBy.firstName} {p.createdBy.lastName}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>

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
