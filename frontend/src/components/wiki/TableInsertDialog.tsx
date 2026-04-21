import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Typography from '@mui/material/Typography'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (opts: { rows: number; cols: number; withHeaderRow: boolean }) => void
}

const MAX = 12

/**
 * Tabelle einfügen: Notion/Word-Stil. Man fährt mit der Maus über ein Raster
 * (12×12) und sieht live die resultierende Größe. Alternativ lassen sich
 * exakte Werte im Zahlenfeld einstellen. Zusätzlich: Header-Zeile Ja/Nein.
 */
export function TableInsertDialog({ open, onClose, onConfirm }: Props) {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [hoverRows, setHoverRows] = useState<number | null>(null)
  const [hoverCols, setHoverCols] = useState<number | null>(null)
  const [withHeaderRow, setWithHeaderRow] = useState(true)

  const vRows = hoverRows ?? rows
  const vCols = hoverCols ?? cols

  const handlePickerEnter = (r: number, c: number) => {
    setHoverRows(r)
    setHoverCols(c)
  }
  const handlePickerLeave = () => {
    setHoverRows(null)
    setHoverCols(null)
  }
  const handlePickerClick = (r: number, c: number) => {
    setRows(r)
    setCols(c)
  }

  const confirm = () => {
    onConfirm({ rows, cols, withHeaderRow })
    // Reset für nächsten Aufruf
    setRows(3); setCols(3); setWithHeaderRow(true)
    setHoverRows(null); setHoverCols(null)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Tabelle einfügen</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Raster unten anklicken oder Werte manuell setzen.
        </Typography>

        {/* Grid-Picker */}
        <Box
          onMouseLeave={handlePickerLeave}
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${MAX}, 18px)`,
            gap: '2px',
            my: 2,
            userSelect: 'none',
          }}
        >
          {Array.from({ length: MAX }).flatMap((_, r) =>
            Array.from({ length: MAX }).map((_, c) => {
              const active = r < vRows && c < vCols
              return (
                <Box
                  key={`${r}-${c}`}
                  onMouseEnter={() => handlePickerEnter(r + 1, c + 1)}
                  onClick={() => handlePickerClick(r + 1, c + 1)}
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: 0.5,
                    border: '1px solid',
                    borderColor: active ? 'primary.main' : 'divider',
                    bgcolor: active ? 'primary.main' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background-color 60ms',
                  }}
                />
              )
            }),
          )}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {vRows} × {vCols}
        </Typography>

        {/* Manuelle Felder */}
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField
            label="Zeilen"
            type="number"
            size="small"
            value={rows}
            onChange={(e) => setRows(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
            inputProps={{ min: 1, max: 50 }}
            sx={{ flex: 1 }}
          />
          <TextField
            label="Spalten"
            type="number"
            size="small"
            value={cols}
            onChange={(e) => setCols(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
            inputProps={{ min: 1, max: 20 }}
            sx={{ flex: 1 }}
          />
        </Box>

        <FormControlLabel
          control={<Checkbox checked={withHeaderRow} onChange={(e) => setWithHeaderRow(e.target.checked)} />}
          label="Erste Zeile als Überschrift"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={confirm}>Einfügen</Button>
      </DialogActions>
    </Dialog>
  )
}
