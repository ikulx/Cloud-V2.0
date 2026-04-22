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
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import SaveIcon from '@mui/icons-material/Save'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import {
  useInternalAlarmTemplates,
  useCreateInternalAlarmTemplate,
  useUpdateInternalAlarmTemplate,
  useDeleteInternalAlarmTemplate,
  type InternalAlarmTemplate,
} from '../../features/alarms/queries'

/**
 * Admin-only Block innerhalb des Alarme-Tabs der SettingsPage.
 * Verwaltung globaler interner Alarm-Empfänger:
 *  - 2 System-Einträge (Piketdienst, Ygnis PM) – E-Mail editierbar, nicht löschbar
 *  - Beliebig viele Custom-Einträge – komplett editierbar + löschbar
 *
 * Die E-Mail-Änderungen greifen sofort: der Dispatcher liest die Adresse
 * bei jedem Alarm neu aus dem Template.
 */
export function InternalAlarmTemplatesSettings() {
  const { data: templates = [], isLoading } = useInternalAlarmTemplates()
  const update = useUpdateInternalAlarmTemplate()
  const del = useDeleteInternalAlarmTemplate()

  // Lokaler Draft-State pro Template-ID (für die E-Mail-Zelle)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedId, setSavedId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)

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

  const remove = async (t: InternalAlarmTemplate) => {
    if (!window.confirm(`Template "${t.label}" wirklich löschen? Bestehende Verknüpfungen in Anlagen werden entfernt.`)) return
    await del.mutateAsync(t.id)
  }

  return (
    <Card sx={{ maxWidth: 760, mt: 3 }}>
      <CardContent sx={{ pt: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5, gap: 2 }}>
          <Box>
            <Typography variant="h6">Interne Alarm-Empfänger</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Empfänger, die nur Admins und Verwalter sehen und konfigurieren –
              pro Anlage individuell aktivierbar. Die E-Mail-Adresse wird hier
              zentral gepflegt und gilt für alle Anlagen. Kunden bekommen diese
              Empfänger weder in der UI noch in der API zu sehen.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Eigenen Empfänger
          </Button>
        </Box>

        {isLoading ? (
          <Typography variant="body2" color="text.secondary">Lädt …</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 170 }}>Bezeichnung</TableCell>
                <TableCell>E-Mail</TableCell>
                <TableCell sx={{ width: 110 }} />
                <TableCell sx={{ width: 50 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={500}>{t.label}</Typography>
                      {t.isSystem && <Chip size="small" label="System" />}
                    </Box>
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
                  <TableCell align="right">
                    {!t.isSystem && (
                      <Tooltip title="Löschen">
                        <IconButton size="small" color="error" onClick={() => void remove(t)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateTemplateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      </CardContent>
    </Card>
  )
}

function CreateTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateInternalAlarmTemplate()
  const [label, setLabel] = useState('')
  const [email, setEmail] = useState('')

  const save = async () => {
    if (!label.trim()) return
    await create.mutateAsync({ label: label.trim(), email: email.trim() || null })
    setLabel('')
    setEmail('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" key={open ? 'open' : 'closed'}>
      <DialogTitle>Eigenen internen Empfänger anlegen</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Bezeichnung"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            placeholder="z. B. Geschäftsleitung"
          />
          <TextField
            label="E-Mail (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            size="small"
            helperText="Adresse kann auch später in der Liste eingetragen werden."
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={() => void save()} disabled={!label.trim() || create.isPending}>
          Anlegen
        </Button>
      </DialogActions>
    </Dialog>
  )
}
