import { useEffect, useState } from 'react'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import { useQueryClient } from '@tanstack/react-query'
import { apiPatch } from '../../lib/api'
import {
  useErzeugerTypes, useCreateErzeugerType, useDeleteErzeugerType,
  type ErzeugerType,
} from '../../features/erzeuger-types/queries'

interface Props {
  serialRequired: boolean
  onSerialRequiredChange: (v: boolean) => void
  saved: boolean
  onSave: () => void
}

/**
 * Verwaltung der Erzeuger-Typen (Katalog, der in Anlagen per Dropdown
 * verfügbar ist) + globales Flag "Seriennummer obligatorisch".
 */
export function ErzeugerSettingsTab({ serialRequired, onSerialRequiredChange, saved, onSave }: Props) {
  const { data: types = [] } = useErzeugerTypes()
  const createMut = useCreateErzeugerType()
  const deleteMut = useDeleteErzeugerType()
  const qc = useQueryClient()

  const patchType = async (id: string, data: Partial<Pick<ErzeugerType, 'name' | 'sortOrder' | 'isActive'>>) => {
    await apiPatch<ErzeugerType>(`/erzeuger-types/${id}`, data)
    await qc.invalidateQueries({ queryKey: ['erzeuger-types'] })
  }

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!editingId) setEditName('')
  }, [editingId])

  const handleAdd = async () => {
    if (!newName.trim()) return
    setMsg(null)
    try {
      const lastOrder = types.reduce((m, t) => Math.max(m, t.sortOrder), 0)
      await createMut.mutateAsync({ name: newName.trim(), sortOrder: lastOrder + 10 })
      setNewName('')
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Fehler' })
    }
  }

  const handleDelete = async (id: string) => {
    setMsg(null)
    try {
      await deleteMut.mutateAsync(id)
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Löschen fehlgeschlagen' })
    }
  }

  return (
    <Card sx={{ maxWidth: 720 }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 3 }}>
        <Typography variant="h6">Erzeuger-Katalog</Typography>
        <Typography variant="body2" color="text.secondary">
          In Anlagen können diese Typen per Dropdown ausgewählt werden. Typen
          lassen sich deaktivieren (dann nicht mehr in neuen Anlagen wählbar,
          bleiben aber in bestehenden Anlagen erhalten) oder löschen, sofern
          sie nicht in Verwendung sind.
        </Typography>

        {msg && <Alert severity={msg.type}>{msg.text}</Alert>}

        <List dense disablePadding>
          {types.map((t) => (
            <ListItem
              key={t.id}
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
              secondaryAction={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {editingId === t.id ? (
                    <EditRow
                      name={editName}
                      onChange={setEditName}
                      onSave={async () => {
                        try {
                          await patchType(t.id, { name: editName.trim() })
                          setEditingId(null)
                        } catch (err) {
                          setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Fehler' })
                        }
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      <Switch
                        size="small"
                        checked={t.isActive}
                        onChange={(e) => { void patchType(t.id, { isActive: e.target.checked }) }}
                      />
                      <IconButton size="small" onClick={() => { setEditingId(t.id); setEditName(t.name) }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleDelete(t.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </>
                  )}
                </Box>
              }
            >
              <ListItemText
                primary={t.name}
                secondary={!t.isActive ? 'inaktiv' : undefined}
                primaryTypographyProps={{ sx: { opacity: t.isActive ? 1 : 0.5 } }}
              />
            </ListItem>
          ))}
        </List>

        {/* Neuer Eintrag */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Neuer Typ"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
            fullWidth
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            disabled={!newName.trim() || createMut.isPending}
          >
            Hinzufügen
          </Button>
        </Box>

        <Divider sx={{ my: 1 }} />

        <Typography variant="h6">Globale Einstellung</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={serialRequired}
              onChange={(e) => onSerialRequiredChange(e.target.checked)}
            />
          }
          label="Seriennummer beim Hinzufügen eines Erzeugers obligatorisch"
        />

        {saved && <Alert severity="success">Einstellung gespeichert.</Alert>}
        <Box>
          <Button variant="contained" onClick={onSave}>Speichern</Button>
        </Box>
      </CardContent>
    </Card>
  )
}

function EditRow({ name, onChange, onSave, onCancel }: {
  name: string
  onChange: (v: string) => void
  onSave: () => Promise<void>
  onCancel: () => void
}) {
  return (
    <>
      <TextField
        size="small"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void onSave() }}
        autoFocus
      />
      <IconButton size="small" onClick={() => void onSave()} disabled={!name.trim()}>
        <CheckIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" onClick={onCancel}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </>
  )
}

