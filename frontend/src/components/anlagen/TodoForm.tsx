import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Autocomplete from '@mui/material/Autocomplete'
import Chip from '@mui/material/Chip'
import { useUsers } from '../../features/users/queries'
import { useGroups } from '../../features/groups/queries'
import { PhotoUploadField } from './PhotoUploadField'

export interface TodoFormValue {
  title: string
  details: string
  dueDate: string // yyyy-MM-dd
  userIds: string[]
  groupIds: string[]
  photoUrls: string[]
}

export const EMPTY_TODO_FORM: TodoFormValue = {
  title: '', details: '', dueDate: '', userIds: [], groupIds: [], photoUrls: [],
}

interface Props {
  value: TodoFormValue
  onChange: (v: TodoFormValue) => void
  /** Wird bei Enter in Titel aufgerufen – z.B. zum Submit. */
  onSubmitHint?: () => void
  disabled?: boolean
  compact?: boolean
}

/**
 * Wiederverwendbares Formular für Anlage-Todos: Titel, Details, Fälligkeit,
 * Zuweisung an Benutzer und/oder Gruppen.
 */
export function TodoForm({ value, onChange, onSubmitHint, disabled, compact }: Props) {
  const { data: users = [] } = useUsers()
  const { data: groups = [] } = useGroups()

  const activeUsers = users.filter((u) => u.isActive !== false)
  const userOptions = activeUsers.map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName}`, email: u.email }))
  const groupOptions = groups.map((g) => ({ id: g.id, label: g.name }))

  const selectedUsers = userOptions.filter((o) => value.userIds.includes(o.id))
  const selectedGroups = groupOptions.filter((o) => value.groupIds.includes(o.id))

  const spacing = compact ? 1 : 2

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: spacing }}>
      <TextField
        size="small"
        label="Titel"
        value={value.title}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter' && onSubmitHint) onSubmitHint() }}
        disabled={disabled}
        fullWidth
      />
      {!compact && (
        <TextField
          size="small"
          label="Details (optional)"
          value={value.details}
          onChange={(e) => onChange({ ...value, details: e.target.value })}
          disabled={disabled}
          fullWidth
          multiline
          minRows={2}
        />
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          type="date"
          label="Fällig bis"
          value={value.dueDate}
          onChange={(e) => onChange({ ...value, dueDate: e.target.value })}
          disabled={disabled}
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 180 }}
        />
        <Autocomplete
          sx={{ minWidth: 240, flex: 1 }}
          size="small"
          multiple
          disabled={disabled}
          options={userOptions}
          value={selectedUsers}
          onChange={(_, v) => onChange({ ...value, userIds: v.map((x) => x.id) })}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderTags={(val, getTagProps) =>
            val.map((opt, idx) => (
              <Chip {...getTagProps({ index: idx })} key={opt.id} size="small" label={opt.label} />
            ))
          }
          renderInput={(params) => <TextField {...params} label="Zuweisen an Benutzer" />}
        />
        <Autocomplete
          sx={{ minWidth: 220, flex: 1 }}
          size="small"
          multiple
          disabled={disabled}
          options={groupOptions}
          value={selectedGroups}
          onChange={(_, v) => onChange({ ...value, groupIds: v.map((x) => x.id) })}
          getOptionLabel={(o) => o.label}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderTags={(val, getTagProps) =>
            val.map((opt, idx) => (
              <Chip {...getTagProps({ index: idx })} key={opt.id} size="small" color="info" label={opt.label} />
            ))
          }
          renderInput={(params) => <TextField {...params} label="Zuweisen an Gruppen" />}
        />
      </Box>
      <PhotoUploadField
        value={value.photoUrls}
        onChange={(urls) => onChange({ ...value, photoUrls: urls })}
        disabled={disabled}
      />
    </Box>
  )
}

/** Konvertiert ein TodoFormValue in das Payload-Format der API. */
export function todoFormToPayload(v: TodoFormValue): {
  title: string
  details: string | null
  dueDate: string | null
  assignedUserIds: string[]
  assignedGroupIds: string[]
  photoUrls: string[]
} {
  return {
    title: v.title.trim(),
    details: v.details.trim() || null,
    // yyyy-MM-dd → ISO DateTime (Mitternacht lokale TZ)
    dueDate: v.dueDate ? new Date(v.dueDate + 'T00:00:00').toISOString() : null,
    assignedUserIds: v.userIds,
    assignedGroupIds: v.groupIds,
    photoUrls: v.photoUrls,
  }
}
