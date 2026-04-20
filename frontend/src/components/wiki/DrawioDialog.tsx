import { useEffect, useRef, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'

/**
 * Drawio-Embed-Dialog.
 *
 * Nutzt den offiziellen iframe-Embed-Modus von diagrams.net:
 *   https://www.drawio.com/doc/faq/embed-mode
 *
 * Kommunikation läuft via window.postMessage mit JSON-Protokoll.
 * Der Dialog gibt dem Aufrufer am Ende das neue XML + ein PNG-DataURI
 * (xmlpng-Format enthält das Diagramm-XML in den Meta-Daten des Bilds)
 * zurück. Das PNG ist gleichzeitig Preview UND Backup des XMLs.
 */

export interface DrawioResult {
  xml: string
  png: string // data:image/png;base64,… – enthält das XML via xmlpng-Format
}

interface Props {
  open: boolean
  /** Initiales XML – leerer String bedeutet "neues Diagramm" */
  initialXml: string
  onClose: () => void
  onSave: (result: DrawioResult) => void
}

// WICHTIG: configure=1 darf hier NICHT gesetzt sein – das veranlasst drawio
// darauf zu warten, dass wir als Host eine 'configure'-Nachricht schicken,
// bevor es initialisiert. Ergebnis: Ladekreis bleibt ewig. Weglassen → init.
const DRAWIO_URL =
  'https://embed.diagrams.net/?embed=1&proto=json&spin=1&libraries=1&saveAndExit=1&noSaveBtn=0&noExitBtn=0&ui=kennedy'

export function DrawioDialog({ open, initialXml, onClose, onSave }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const savedRef = useRef(false)

  useEffect(() => {
    if (!open) { setReady(false); savedRef.current = false }
  }, [open])

  useEffect(() => {
    if (!open) return

    const handler = (event: MessageEvent) => {
      // Nur Nachrichten vom drawio-Frame akzeptieren.
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return

      let msg: { event?: string; xml?: string; data?: string }
      try {
        msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }

      const send = (payload: Record<string, unknown>) => {
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify(payload), '*')
      }

      if (msg.event === 'init') {
        setReady(true)
        send({ action: 'load', xml: initialXml || '' })
      } else if (msg.event === 'save') {
        // User hat im drawio auf "Speichern" gedrückt → als PNG (mit XML) exportieren
        send({ action: 'export', format: 'xmlpng' })
      } else if (msg.event === 'export') {
        // Export-Ergebnis eingetroffen
        if (msg.data && msg.xml) {
          savedRef.current = true
          onSave({ xml: msg.xml, png: msg.data })
          onClose()
        }
      } else if (msg.event === 'exit') {
        onClose()
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [open, initialXml, onSave, onClose])

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{ sx: { bgcolor: 'background.default' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1 }}>
        <Typography variant="h6">Diagramm bearbeiten</Typography>
        {!ready && <CircularProgress size={20} />}
      </DialogTitle>
      <Box sx={{ flex: 1, display: 'flex', position: 'relative', minHeight: 0 }}>
        {open && (
          <iframe
            ref={iframeRef}
            src={DRAWIO_URL}
            title="drawio"
            style={{
              border: 'none',
              width: '100%',
              height: '100%',
              background: '#fff',
            }}
          />
        )}
      </Box>
      <DialogActions>
        <Button onClick={onClose}>Schließen ohne Speichern</Button>
      </DialogActions>
    </Dialog>
  )
}
