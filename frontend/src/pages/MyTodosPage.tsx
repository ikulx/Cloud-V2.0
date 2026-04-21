import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import IconButton from '@mui/material/IconButton'
import EditIcon from '@mui/icons-material/Edit'
import { Link as RouterLink } from 'react-router-dom'
import { useMyTodos, type MyTodoScope, type MyTodoStatus } from '../features/my-todos/queries'
import { useUpdateAnlageTodo } from '../features/anlagen/queries'
import { TodoEditDialog } from '../components/anlagen/TodoEditDialog'
import { useQueryClient } from '@tanstack/react-query'
import { apiPatch } from '../lib/api'
import type { MyTodo } from '../types/model'

export function MyTodosPage() {
  const [scope, setScope] = useState<MyTodoScope>('all')
  const [status, setStatus] = useState<MyTodoStatus>('OPEN')
  const [editTodo, setEditTodo] = useState<MyTodo | null>(null)
  const { data: todos = [], isLoading } = useMyTodos(scope, status)
  const qc = useQueryClient()

  const handleSave: Parameters<typeof TodoEditDialog>[0]['onSave'] = async (anlageId, todoId, payload) => {
    await apiPatch(`/anlagen/${anlageId}/todos/${todoId}`, payload)
    await qc.invalidateQueries({ queryKey: ['me', 'todos'] })
    await qc.invalidateQueries({ queryKey: ['anlagen', anlageId] })
  }

  return (
    <Box>
      <Typography variant="h5" mb={2}>Meine Todos</Typography>

      <Paper sx={{ mb: 2 }}>
        <Tabs value={scope} onChange={(_, v) => setScope(v as MyTodoScope)}>
          <Tab value="all" label="Alle" />
          <Tab value="mine" label="Mir direkt zugewiesen" />
          <Tab value="groups" label="Über Gruppen" />
        </Tabs>
      </Paper>

      <Box sx={{ mb: 2 }}>
        <Tabs value={status} onChange={(_, v) => setStatus(v as MyTodoStatus)} variant="standard">
          <Tab value="OPEN" label="Offen" />
          <Tab value="DONE" label="Erledigt" />
        </Tabs>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : todos.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          {status === 'OPEN' ? 'Keine offenen Todos.' : 'Keine erledigten Todos.'}
        </Typography>
      ) : (
        <List disablePadding>
          {todos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} onEdit={() => setEditTodo(todo)} />
          ))}
        </List>
      )}

      <TodoEditDialog
        open={Boolean(editTodo)}
        anlageId={editTodo?.anlage.id ?? ''}
        todo={editTodo}
        onClose={() => setEditTodo(null)}
        onSave={handleSave}
      />
    </Box>
  )
}

function TodoRow({ todo, onEdit }: { todo: MyTodo; onEdit: () => void }) {
  const updateMut = useUpdateAnlageTodo(todo.anlage.id)
  const overdue = todo.status === 'OPEN' && todo.dueDate && new Date(todo.dueDate) < new Date()

  return (
    <ListItem
      sx={{
        bgcolor: 'background.paper',
        mb: 0.5,
        borderRadius: 1,
        px: 1.5,
        alignItems: 'flex-start',
        border: overdue ? '1px solid' : 'none',
        borderColor: overdue ? 'error.main' : 'transparent',
      }}
      secondaryAction={
        <IconButton size="small" onClick={onEdit}>
          <EditIcon fontSize="small" />
        </IconButton>
      }
    >
      <Checkbox
        checked={todo.status === 'DONE'}
        onChange={() => updateMut.mutate({
          todoId: todo.id,
          status: todo.status === 'DONE' ? 'OPEN' : 'DONE',
        })}
        size="small"
        sx={{ mt: 0.5 }}
      />
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <span style={{ textDecoration: todo.status === 'DONE' ? 'line-through' : 'none', fontWeight: 500 }}>
              {todo.title}
            </span>
            {todo.dueDate && (
              <Chip
                size="small"
                color={overdue ? 'error' : 'default'}
                label={`Fällig: ${new Date(todo.dueDate).toLocaleDateString('de-CH')}`}
              />
            )}
            {todo.assignmentMine && <Chip size="small" color="primary" label="Mir zugewiesen" />}
            {todo.assignmentViaGroup && todo.assignedGroups.map((ag) => (
              <Chip key={ag.group.id} size="small" color="info" label={`Gruppe: ${ag.group.name}`} />
            ))}
          </Box>
        }
        secondary={
          <Box>
            {todo.details && <Typography variant="body2" sx={{ color: 'text.primary', mb: 0.5 }}>{todo.details}</Typography>}
            <Typography variant="caption" color="text.secondary">
              Anlage:{' '}
              <RouterLink to={`/anlagen/${todo.anlage.id}`} style={{ color: 'inherit' }}>
                <strong>{todo.anlage.name}</strong>
                {todo.anlage.projectNumber ? ` (${todo.anlage.projectNumber})` : ''}
              </RouterLink>
              {' · '}erstellt von {todo.createdBy.firstName} {todo.createdBy.lastName}{' '}
              am {new Date(todo.createdAt).toLocaleDateString('de-CH')}
            </Typography>
          </Box>
        }
      />
    </ListItem>
  )
}
