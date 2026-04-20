import { useEffect, useMemo, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Autocomplete from '@mui/material/Autocomplete'
import Chip from '@mui/material/Chip'
import DeleteIcon from '@mui/icons-material/Close'
import Alert from '@mui/material/Alert'
import {
  useWikiPermissions, useSaveWikiPermissions,
  type WikiPermissionEntry, type WikiAccessTarget, type WikiAccessLevel,
} from '../../features/wiki/queries'
import { useRoles } from '../../features/roles/queries'
import { useGroups } from '../../features/groups/queries'
import { useUsers } from '../../features/users/queries'

interface Props {
  open: boolean
  pageId: string | null
  pageTitle: string
  onClose: () => void
}

interface TargetOption {
  type: WikiAccessTarget
  id: string
  label: string
  sub?: string
}

export function WikiPermissionsDialog({ open, pageId, pageTitle, onClose }: Props) {
  const { data: initial } = useWikiPermissions(open ? pageId : null)
  const saveMut = useSaveWikiPermissions(pageId ?? '')
  const { data: roles } = useRoles()
  const { data: groups } = useGroups()
  const { data: users } = useUsers()

  const [entries, setEntries] = useState<WikiPermissionEntry[]>([])
  const [pendingTarget, setPendingTarget] = useState<TargetOption | null>(null)
  const [pendingLevel, setPendingLevel] = useState<WikiAccessLevel>('VIEW')

  useEffect(() => {
    if (open) setEntries(initial ?? [])
  }, [open, initial])

  const options: TargetOption[] = useMemo(() => {
    const list: TargetOption[] = []
    for (const r of roles ?? []) list.push({ type: 'ROLE', id: r.id, label: `Rolle: ${r.name}` })
    for (const g of groups ?? []) list.push({ type: 'GROUP', id: g.id, label: `Gruppe: ${g.name}` })
    for (const u of users ?? []) list.push({ type: 'USER', id: u.id, label: `${u.firstName} ${u.lastName}`, sub: u.email })
    return list
  }, [roles, groups, users])

  const labelFor = (e: WikiPermissionEntry): { label: string; sub?: string } => {
    if (e.targetType === 'ROLE') {
      const r = roles?.find((x) => x.id === e.targetId)
      return { label: `Rolle: ${r?.name ?? e.targetId}` }
    }
    if (e.targetType === 'GROUP') {
      const g = groups?.find((x) => x.id === e.targetId)
      return { label: `Gruppe: ${g?.name ?? e.targetId}` }
    }
    const u = users?.find((x) => x.id === e.targetId)
    return { label: u ? `${u.firstName} ${u.lastName}` : e.targetId, sub: u?.email }
  }

  const add = () => {
    if (!pendingTarget) return
    const exists = entries.some((e) => e.targetType === pendingTarget.type && e.targetId === pendingTarget.id)
    if (exists) return
    setEntries([...entries, { targetType: pendingTarget.type, targetId: pendingTarget.id, level: pendingLevel }])
    setPendingTarget(null)
    setPendingLevel('VIEW')
  }

  const remove = (idx: number) => {
    setEntries(entries.filter((_, i) => i !== idx))
  }

  const setLevel = (idx: number, level: WikiAccessLevel) => {
    setEntries(entries.map((e, i) => (i === idx ? { ...e, level } : e)))
  }

  const handleSave = async () => {
    if (!pageId) return
    await saveMut.mutateAsync(entries)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Zugriff verwalten: {pageTitle}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Diese Regeln gelten auch für alle Unterseiten – solange die Unterseite nicht
          selbst eigene Einträge hat. Ohne Einträge greift das globale
          <code> wiki:read / wiki:update</code> der Rolle.
        </Alert>

        {/* Vorhandene Einträge */}
        <List dense disablePadding sx={{ mb: 2 }}>
          {entries.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              Keine Einträge – globale Rolle-Rechte gelten.
            </Typography>
          )}
          {entries.map((e, idx) => {
            const meta = labelFor(e)
            return (
              <ListItem
                key={`${e.targetType}-${e.targetId}`}
                secondaryAction={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Select
                      value={e.level}
                      size="small"
                      onChange={(ev) => setLevel(idx, ev.target.value as WikiAccessLevel)}
                    >
                      <MenuItem value="VIEW">Lesen</MenuItem>
                      <MenuItem value="EDIT">Bearbeiten</MenuItem>
                    </Select>
                    <IconButton edge="end" size="small" onClick={() => remove(idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                }
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={e.targetType === 'ROLE' ? 'Rolle' : e.targetType === 'GROUP' ? 'Gruppe' : 'Benutzer'}
                        size="small"
                        color={e.targetType === 'ROLE' ? 'primary' : e.targetType === 'GROUP' ? 'info' : 'default'}
                        variant="outlined"
                      />
                      <span>{meta.label}</span>
                    </Box>
                  }
                  secondary={meta.sub}
                />
              </ListItem>
            )
          })}
        </List>

        {/* Neuer Eintrag */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', borderTop: '1px solid', borderColor: 'divider', pt: 2 }}>
          <Autocomplete
            sx={{ flex: 1 }}
            options={options}
            value={pendingTarget}
            onChange={(_, val) => setPendingTarget(val)}
            getOptionLabel={(o) => o.label}
            renderOption={(props, option) => (
              <li {...props} key={`${option.type}-${option.id}`}>
                <Box>
                  <Typography variant="body2">{option.label}</Typography>
                  {option.sub && <Typography variant="caption" color="text.secondary">{option.sub}</Typography>}
                </Box>
              </li>
            )}
            isOptionEqualToValue={(a, b) => a.type === b.type && a.id === b.id}
            renderInput={(params) => <TextField {...params} label="Benutzer / Rolle / Gruppe" size="small" />}
          />
          <Select
            size="small"
            value={pendingLevel}
            onChange={(e) => setPendingLevel(e.target.value as WikiAccessLevel)}
          >
            <MenuItem value="VIEW">Lesen</MenuItem>
            <MenuItem value="EDIT">Bearbeiten</MenuItem>
          </Select>
          <Button variant="contained" disabled={!pendingTarget} onClick={add}>
            Hinzufügen
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Abbrechen</Button>
        <Button variant="contained" onClick={handleSave} disabled={saveMut.isPending}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  )
}
