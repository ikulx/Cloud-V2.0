import { useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import SaveIcon from '@mui/icons-material/Save'
import {
  useInternalAlarmTemplates,
  useUpdateInternalAlarmTemplate,
  type InternalAlarmTemplate,
} from '../../features/alarms/queries'

/**
 * Admin-only Block innerhalb des Alarme-Tabs der SettingsPage.
 * Zentrale E-Mail-Pflege für die beiden System-Empfänger:
 *  - Piketdienst
 *  - Ygnis PM
 *
 * Änderungen greifen sofort: der Dispatcher liest die Adresse bei jedem
 * Alarm neu aus dem Template. Eigene (anlage-spezifische) interne Empfänger
 * werden nicht hier, sondern pro Anlage im Alarm-Tab angelegt.
 */
export function InternalAlarmTemplatesSettings() {
  const { data: templates = [], isLoading } = useInternalAlarmTemplates()
  const update = useUpdateInternalAlarmTemplate()

  // Lokaler Draft-State pro Template-ID (für die E-Mail-Zelle)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)

  const emailFor = (t: InternalAlarmTemplate) =>
    t.id in drafts ? drafts[t.id] : (t.email ?? '')

  const hasUnsaved = (t: InternalAlarmTemplate) =>
    t.id in drafts && drafts[t.id] !== (t.email ?? '')

  const save = async (t: InternalAlarmTemplate) => {
    const next = emailFor(t).trim()
    if (next === (t.email ?? '')) return
    await update.mutateAsync({ id: t.id, email: next || null })
    setDrafts((d) => { const n = { ...d }; delete n[t.id]; return n })
    setSavedId(t.id)
    setTimeout(() => setSavedId(null), 2000)
  }

  return (
    <Card sx={{ maxWidth: 760, mt: 3 }}>
      <CardContent sx={{ pt: 3 }}>
        <Typography variant="h6">Globale interne Empfänger</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          Zentrale E-Mail-Adressen für die zwei festen System-Empfänger. Die
          Adressen gelten für alle Anlagen; welche Anlage welche Rolle tatsächlich
          benachrichtigt (mit welchen Prioritäten / Zeitplan / Verzögerung),
          wird pro Anlage im Alarm-Tab festgelegt. Kunden sehen diese Empfänger
          nirgendwo.
        </Typography>

        {isLoading ? (
          <Typography variant="body2" color="text.secondary">Lädt …</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 170 }}>Bezeichnung</TableCell>
                <TableCell>E-Mail</TableCell>
                <TableCell sx={{ width: 110 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.filter((t) => t.isSystem).map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{t.label}</Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      type="email"
                      placeholder="adresse@example.com"
                      value={emailFor(t)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void save(t) }}
                      inputProps={{ style: { fontFamily: 'monospace', fontSize: 13 } }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<SaveIcon fontSize="small" />}
                      disabled={!hasUnsaved(t) || update.isPending}
                      onClick={() => void save(t)}
                    >
                      {savedId === t.id ? '✓' : 'Speichern'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary">
            💡 Weitere interne Empfänger (mit eigener Adresse) legen Sie direkt
            in der jeweiligen Anlage unter <strong>Alarme → Interne Empfänger →
            „Intern hinzufügen"</strong> an.
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}
