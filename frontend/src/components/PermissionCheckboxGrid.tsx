import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import type { Permission } from '../types/model'

interface Props {
  permissions: Permission[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}

const RESOURCE_LABELS: Record<string, string> = {
  users: 'Benutzer',
  devices: 'Geräte',
  anlagen: 'Anlagen',
  groups: 'Gruppen',
  roles: 'Rollen',
  todos: 'Todos',
  logbook: 'Logbuch',
}

export function PermissionCheckboxGrid({ permissions, selected, onChange, disabled }: Props) {
  const grouped = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    const [resource] = p.key.split(':')
    if (!acc[resource]) acc[resource] = []
    acc[resource].push(p)
    return acc
  }, {})

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <Box>
      {Object.entries(grouped).map(([resource, perms]) => (
        <Box key={resource} mb={2}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {RESOURCE_LABELS[resource] ?? resource}
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1}>
            {perms.map((p) => (
              <FormControlLabel
                key={p.id}
                control={
                  <Checkbox
                    size="small"
                    checked={selected.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    disabled={disabled}
                  />
                }
                label={
                  <Typography variant="body2" title={p.description ?? undefined}>
                    {p.key.split(':')[1]}
                  </Typography>
                }
              />
            ))}
          </Box>
          <Divider sx={{ mt: 1 }} />
        </Box>
      ))}
    </Box>
  )
}
