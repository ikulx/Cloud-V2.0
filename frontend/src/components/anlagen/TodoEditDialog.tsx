import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import { TodoForm, todoFormToPayload, type TodoFormValue, EMPTY_TODO_FORM } from './TodoForm'
import type { AnlageTodo } from '../../types/model'

interface Props {
  open: boolean
  anlageId: string
  todo: AnlageTodo | null
  onClose: () => void
  onSave: (anlageId: string, todoId: string, payload: ReturnType<typeof todoFormToPayload>) => Promise<void>
}

/** Dialog zum Bearbeiten eines Todos (Titel, Details, Fälligkeit, Zuweisungen). */
export function TodoEditDialog({ open, anlageId, todo, onClose, onSave }: Props) {
  const [form, setForm] = useState<TodoFormValue>(EMPTY_TODO_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && todo) {
      setForm({
        title: todo.title,
        details: todo.details ?? '',
        dueDate: todo.dueDate ? new Date(todo.dueDate).toISOString().slice(0, 10) : '',
        userIds: todo.assignedUsers.map((u) => u.user.id),
        groupIds: todo.assignedGroups.map((g) => g.group.id),
        photoUrls: todo.photoUrls ?? [],
      })
      setError(null)
    }
  }, [open, todo])

  const hasAssignment = form.userIds.length > 0 || form.groupIds.length > 0
  const canSubmit = form.title.trim().length > 0 && hasAssignment

  const handleSave = async () => {
    if (!todo || !canSubmit) return
    setBusy(true); setError(null)
    try {
      await onSave(anlageId, todo.id, todoFormToPayload(form))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Todo bearbeiten</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <TodoForm value={form} onChange={setForm} disabled={busy} />
          {!hasAssignment && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Mindestens ein Benutzer oder eine Gruppe muss zugewiesen sein.
            </Alert>
          )}
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Abbrechen</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSubmit || busy}>
          Speichern
        </Button>
      </DialogActions>
    </Dialog>
  )
}
