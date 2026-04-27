import { useEffect, useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import { useSettings, useUpdateSettings } from '../../features/settings/queries'

/**
 * Steuert den täglichen Todo-Digest:
 * - todos.digestHour: zu welcher Stunde (0–23, Server-TZ) gehen die
 *   gebündelten Reminder-Mails raus
 *
 * Das eigentliche Feature steckt im Backend-Scheduler. Pro Empfänger geht
 * EIN Mail mit ALLEN Todos die in den nächsten 24h fällig werden – statt
 * vieler einzelner Reminder-Mails.
 */
export function TodoDigestCard() {
  const { data: settings } = useSettings(true)
  const update = useUpdateSettings()
  const [hour, setHour] = useState('8')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settings) return
    setHour(settings['todos.digestHour'] ?? '8')
  }, [settings])

  const lastRun = settings?.['todos.lastDigestRunAt']
  const lastRunFmt = lastRun ? new Date(lastRun).toLocaleString('de-CH') : '—'

  const handleSave = async () => {
    await update.mutateAsync({ 'todos.digestHour': hour })
    setSaved(true); setTimeout(() => setSaved(false), 3000)
  }

  return (
    <Card sx={{ maxWidth: 560, mt: 3 }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 3 }}>
        <Typography variant="h6">Todo-Tagesdigest</Typography>
        <Typography variant="body2" color="text.secondary">
          Statt für jedes fällige Todo eine eigene Mail zu schicken, bündelt der
          Server alle in den nächsten 24 Stunden fälligen Todos in eine einzige
          Tagesmail pro Empfänger. Die Mail geht zur unten konfigurierten
          Stunde raus (Server-Zeitzone).
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Hinweis: die Sofort-Benachrichtigung beim Erstellen eines Todos
          ist davon nicht betroffen – die geht weiterhin direkt nach dem
          Anlegen.
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <TextField
            label="Versand-Stunde"
            type="number"
            value={hour}
            onChange={(e) => setHour(e.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 23 } }}
            sx={{ width: 160 }}
            helperText="0–23 (Server-TZ). Default 8 = morgens 08:00."
          />
        </Box>

        <Typography variant="caption" color="text.secondary">
          Letzter Digest-Versand: {lastRunFmt}
        </Typography>

        {saved && <Alert severity="success">Gespeichert</Alert>}

        <Box>
          <Button variant="contained" onClick={handleSave}>Speichern</Button>
        </Box>
      </CardContent>
    </Card>
  )
}
