import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import LinearProgress from '@mui/material/LinearProgress'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import imageCompression from 'browser-image-compression'

interface Props {
  value: string[]
  onChange: (urls: string[]) => void
  disabled?: boolean
  label?: string
}

const COMPRESSION_OPTIONS = {
  maxSizeMB: 1.2,           // ~1.2 MB Ziel nach Kompression
  maxWidthOrHeight: 1920,   // 2K Max-Kante, genug für alles
  useWebWorker: true,
  initialQuality: 0.82,
  fileType: 'image/jpeg',   // HEIC/PNG/WebP → JPEG (kleinste + breiteste Kompatibilität)
}

/**
 * Foto-Upload-Feld mit Client-seitiger Kompression.
 * - Multi-File-Auswahl oder Drag&Drop
 * - Thumbnails mit Lösch-Button
 * - Während Upload: Spinner + Progress-Bar pro Datei
 */
export function PhotoUploadField({ value, onChange, disabled, label = 'Fotos' }: Props) {
  const [busy, setBusy] = useState<{ total: number; done: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const mq = window.matchMedia('(pointer: coarse)')
      setIsTouchDevice(mq.matches)
      const handler = (e: MediaQueryListEvent) => setIsTouchDevice(e.matches)
      mq.addEventListener?.('change', handler)
      return () => mq.removeEventListener?.('change', handler)
    } catch {
      // noop
    }
  }, [])

  const uploadFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (images.length === 0) return
    setBusy({ total: images.length, done: 0 })
    setError(null)
    const token = localStorage.getItem('accessToken')
    const uploaded: string[] = []
    try {
      for (let i = 0; i < images.length; i++) {
        const original = images[i]
        // Komprimieren (große Handy-Fotos werden oft von 8 MB auf ~600 KB gestampft)
        let toUpload: Blob = original
        try {
          toUpload = await imageCompression(original, COMPRESSION_OPTIONS)
        } catch {
          // Fallback: Original hochladen
        }
        const fd = new FormData()
        fd.append('file', new File([toUpload], original.name.replace(/\.(heic|heif)$/i, '.jpg'), {
          type: (toUpload as Blob).type || 'image/jpeg',
        }))
        const res = await fetch('/api/uploads/photo', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        })
        if (!res.ok) {
          let msg = 'Upload fehlgeschlagen'
          try { const e = await res.json() as { message?: string }; msg = e.message ?? msg } catch { /* noop */ }
          throw new Error(msg)
        }
        const data = await res.json() as { url: string }
        uploaded.push(data.url)
        setBusy({ total: images.length, done: i + 1 })
      }
      onChange([...value, ...uploaded])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx))
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>

      {value.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          {value.map((url, idx) => (
            <Box
              key={url + idx}
              sx={{
                position: 'relative',
                width: 96, height: 96,
                borderRadius: 1,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box
                component="img"
                src={url}
                alt=""
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {!disabled && (
                <Tooltip title="Entfernen">
                  <IconButton
                    size="small"
                    onClick={() => remove(idx)}
                    sx={{
                      position: 'absolute', top: 2, right: 2,
                      bgcolor: 'rgba(0,0,0,0.55)',
                      color: 'white',
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                      p: 0.25,
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Box
        onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled) return
          e.preventDefault(); setDragOver(false)
          const files = Array.from(e.dataTransfer.files ?? [])
          if (files.length > 0) void uploadFiles(files)
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1,
          border: '1px dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          borderRadius: 1,
          bgcolor: dragOver ? 'action.hover' : 'transparent',
        }}
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={busy ? <CircularProgress size={14} /> : <PhotoCameraIcon />}
          disabled={disabled || !!busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? `Lade hoch (${busy.done}/${busy.total}) …` : 'Fotos wählen'}
        </Button>
        {isTouchDevice && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<PhotoCameraIcon />}
            disabled={disabled || !!busy}
            onClick={() => cameraInputRef.current?.click()}
          >
            Kamera
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">
          oder hierher ziehen · automatisch komprimiert
        </Typography>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = '' // damit gleiche Datei nochmal gehen würde
            if (files.length > 0) await uploadFiles(files)
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length > 0) await uploadFiles(files)
          }}
        />
      </Box>

      {busy && (
        <LinearProgress
          variant="determinate"
          value={busy.total ? (busy.done / busy.total) * 100 : 0}
          sx={{ mt: 0.5 }}
        />
      )}
      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  )
}
