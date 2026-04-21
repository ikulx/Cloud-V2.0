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
import LinearProgress from '@mui/material/LinearProgress'
import Autocomplete from '@mui/material/Autocomplete'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import UploadIcon from '@mui/icons-material/UploadFile'
import { parseImportFile, parseImportZip, isZipFile, type ImportResult } from './import-helpers'
import type { WikiPageNode } from '../../features/wiki/queries'

interface Props {
  open: boolean
  onClose: () => void
  pages: WikiPageNode[]
  /** Wird pro Seite aufgerufen. */
  onConfirm: (data: { title: string; content: unknown; parentId: string | null }) => Promise<void>
}

type Progress = { msg: string; done: number; total: number } | null

export function WikiImportDialog({ open, onClose, pages, onConfirm }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [single, setSingle] = useState<ImportResult | null>(null)
  const [multi, setMulti] = useState<ImportResult[] | null>(null)
  const [customTitle, setCustomTitle] = useState('')
  const [parentOption, setParentOption] = useState<WikiPageNode | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Progress>(null)
  const [error, setError] = useState<string | null>(null)

  const folderOptions = pages.filter((p) => p.type === 'FOLDER' && p.canEdit)

  const reset = () => {
    setFile(null); setSingle(null); setMulti(null)
    setCustomTitle(''); setParentOption(null); setError(null)
    setBusy(false); setDragOver(false); setProgress(null)
  }

  const handleClose = () => { reset(); onClose() }

  const handleFile = async (f: File) => {
    setError(null); setFile(f); setSingle(null); setMulti(null)
    setBusy(true); setProgress(null)
    try {
      if (isZipFile(f)) {
        const results = await parseImportZip(f, (msg, done, total) =>
          setProgress({ msg, done, total }),
        )
        setMulti(results)
      } else {
        const result = await parseImportFile(f)
        setSingle(result)
        setCustomTitle(result.title)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden')
    } finally {
      setBusy(false)
    }
  }

  const handleImportSingle = async () => {
    if (!single) return
    setBusy(true); setError(null)
    try {
      await onConfirm({
        title: customTitle.trim() || single.title,
        content: single.content,
        parentId: parentOption?.id ?? null,
      })
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally { setBusy(false) }
  }

  const handleImportMulti = async () => {
    if (!multi) return
    setBusy(true); setError(null)
    const total = multi.length
    let done = 0
    try {
      for (const r of multi) {
        setProgress({ msg: `Erstelle: ${r.title}`, done, total })
        await onConfirm({
          title: r.title,
          content: r.content,
          parentId: parentOption?.id ?? null,
        })
        done++
      }
      setProgress({ msg: 'Fertig', done: total, total })
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen')
    } finally { setBusy(false) }
  }

  const totalImages = multi
    ? multi.reduce((s, r) => s + r.images, 0)
    : single?.images ?? 0

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Seite importieren</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          BookStack- oder Wiki-Export hochladen: <strong>HTML</strong>,
          <strong> Markdown</strong> oder ein <strong>ZIP</strong>-Archiv mit
          mehreren Seiten und Bildern. Struktur und Basis-Formatierung
          werden übernommen, Bilder im ZIP automatisch auf den Server
          geladen.
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
            input.accept = '.html,.htm,.md,.markdown,.zip,text/html,text/markdown,application/zip'
            input.onchange = () => { const f = input.files?.[0]; if (f) void handleFile(f) }
            input.click()
          }}
        >
          <UploadIcon sx={{ fontSize: 36, color: 'text.secondary' }} />
          <Typography sx={{ mt: 1 }}>
            {file ? file.name : 'Datei hierher ziehen oder klicken'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            .html · .htm · .md · .markdown · .zip
          </Typography>
        </Box>

        {busy && progress && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">{progress.msg}</Typography>
            <LinearProgress
              variant="determinate"
              value={progress.total ? (progress.done / progress.total) * 100 : 0}
              sx={{ mt: 0.5 }}
            />
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Einzeldatei: Titel editierbar */}
        {single && !multi && (
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
          </Box>
        )}

        {/* ZIP: Liste der Seiten */}
        {multi && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Autocomplete
              options={folderOptions}
              value={parentOption}
              onChange={(_, v) => setParentOption(v)}
              getOptionLabel={(o) => (o.icon ? `${o.icon} ` : '') + o.title}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(p) => (
                <TextField {...p} label="Ziel-Ordner (optional)" size="small"
                  helperText="Alle Seiten werden hier angelegt" />
              )}
            />
            <Typography variant="body2" color="text.secondary">
              <strong>{multi.length}</strong> Seite{multi.length === 1 ? '' : 'n'} gefunden:
            </Typography>
            <List dense sx={{ maxHeight: 220, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              {multi.map((r, idx) => (
                <ListItem key={idx}>
                  <ListItemText
                    primary={r.title}
                    secondary={r.images > 0 ? `${r.images} Bild(er)` : undefined}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {(single || multi) && totalImages > 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {totalImages} Bild{totalImages === 1 ? '' : 'er'} insgesamt
            {multi ? ' – bereits hochgeladen und verknüpft.' : ' erkannt.'}
          </Alert>
        )}

        {single?.warnings.map((w, i) => <Alert key={i} severity="warning" sx={{ mt: 1 }}>{w}</Alert>)}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>Abbrechen</Button>
        <Button
          variant="contained"
          onClick={multi ? handleImportMulti : handleImportSingle}
          disabled={busy || (!single && !multi) || (!!single && !customTitle.trim())}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
        >
          {multi ? `${multi.length} Seite${multi.length === 1 ? '' : 'n'} importieren` : 'Importieren'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
