import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Autocomplete from '@mui/material/Autocomplete'
import UploadIcon from '@mui/icons-material/UploadFile'
import { parseImportFile, type ImportResult } from './import-helpers'
import type { WikiPageNode } from '../../features/wiki/queries'

interface Props {
  open: boolean
  onClose: () => void
  pages: WikiPageNode[]
  /** Wird mit fertigem { title, content, parentId } aufgerufen, sobald der
   *  User auf "Importieren" klickt. */
  onConfirm: (data: { title: string; content: unknown; parentId: string | null }) => Promise<void>
}

export function WikiImportDialog({ open, onClose, pages, onConfirm }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ImportResult | null>(null)
  const [customTitle, setCustomTitle] = useState('')
  const [parentOption, setParentOption] = useState<WikiPageNode | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const folderOptions = pages
    .filter((p) => p.type === 'FOLDER' && p.canEdit)

  const reset = () => {
    setFile(null); setParsed(null); setCustomTitle('')
    setParentOption(null); setError(null); setBusy(false); setDragOver(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFile = async (f: File) => {
    setError(null); setFile(f); setParsed(null)
    try {
      const result = await parseImportFile(f)
      setParsed(result)
      setCustomTitle(result.title)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden')
    }
  }

  const handleImport = async () => {
    if (!parsed) return
    setBusy(true); setError(null)
    try {
      await onConfirm({
        title: customTitle.trim() || parsed.title,
        content: parsed.content,
        parentId: parentOption?.id ?? null,
      })
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Seite importieren</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          BookStack oder eine andere Seite als <strong>HTML</strong> oder
          <strong> Markdown</strong> exportieren und hier hochladen. Struktur
          und Basis-Formatierung (Überschriften, Listen, Links, Bilder, Tabellen,
          Code) werden übernommen.
        </Typography>

        {/* Drop Zone */}
        <Box
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f) void handleFile(f)
          }}
          sx={{
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : 'divider',
            bgcolor: dragOver ? 'action.hover' : 'transparent',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            cursor: 'pointer',
            mb: 2,
          }}
          onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.html,.htm,.md,.markdown,text/html,text/markdown'
            input.onchange = () => { const f = input.files?.[0]; if (f) void handleFile(f) }
            input.click()
          }}
        >
          <UploadIcon sx={{ fontSize: 36, color: 'text.secondary' }} />
          <Typography sx={{ mt: 1 }}>
            {file ? file.name : 'Datei hierher ziehen oder klicken'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            .html · .htm · .md · .markdown
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {parsed && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Titel"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              fullWidth
              size="small"
            />
            <Autocomplete
              options={folderOptions}
              value={parentOption}
              onChange={(_, v) => setParentOption(v)}
              getOptionLabel={(o) => (o.icon ? `${o.icon} ` : '') + o.title}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(p) => (
                <TextField {...p} label="Ziel-Ordner (optional)" size="small"
                  helperText="Leer lassen → Wurzel-Ebene" />
              )}
            />
            {parsed.images > 0 && (
              <Alert severity="info">
                {parsed.images} Bild{parsed.images === 1 ? '' : 'er'} erkannt – werden als
                externe Verweise importiert. Bei Bedarf später im Editor durch lokale
                Uploads ersetzen.
              </Alert>
            )}
            {parsed.warnings.map((w, i) => (
              <Alert key={i} severity="warning">{w}</Alert>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>Abbrechen</Button>
        <Button
          variant="contained"
          onClick={handleImport}
          disabled={!parsed || busy || !customTitle.trim()}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
        >
          Importieren
        </Button>
      </DialogActions>
    </Dialog>
  )
}
