import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Drawer from '@mui/material/Drawer'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import Tooltip from '@mui/material/Tooltip'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useRoles, usePermissions, useCreateRole, useUpdateRole, useDeleteRole } from '../features/roles/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PermissionCheckboxGrid } from '../components/PermissionCheckboxGrid'
import { usePermission } from '../hooks/usePermission'
import { useTranslation } from 'react-i18next'
import type { Role } from '../types/model'

const PRIVILEGED = ['admin', 'verwalter']

export function RolesPage() {
  const { data: roles, isLoading } = useRoles()
  const { data: permissions } = usePermissions()
  const { t } = useTranslation()
  const canCreate = usePermission('roles:create')
  const canUpdate = usePermission('roles:update')
  const canDelete = usePermission('roles:delete')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editRole, setEditRole] = useState<Role | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedPermIds, setSelectedPermIds] = useState<string[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null)
  const [formError, setFormError] = useState('')

  const createMutation = useCreateRole()
  const updateMutation = useUpdateRole(editRole?.id ?? '')
  const deleteMutation = useDeleteRole()

  const openCreate = () => {
    setEditRole(null); setName(''); setDescription(''); setSelectedPermIds([]); setFormError(''); setDrawerOpen(true)
  }
  const openEdit = (r: Role) => {
    setEditRole(r)
    setName(r.name)
    setDescription(r.description ?? '')
    setSelectedPermIds(r.permissions.map((rp) => rp.permission.id))
    setFormError(''); setDrawerOpen(true)
  }

  const handleSave = async () => {
    setFormError('')
    try {
      const data = { name, description, permissionIds: selectedPermIds }
      if (editRole) await updateMutation.mutateAsync(data)
      else await createMutation.mutateAsync(data)
      setDrawerOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('roles.title', { count: roles?.length ?? 0 })}</Typography>
        {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('roles.create')}</Button>}
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>{t('common.description')}</TableCell>
              <TableCell>{t('roles.permissions')}</TableCell>
              <TableCell>{t('roles.users')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {roles?.map((role) => (
              <TableRow key={role.id} hover>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={1}>
                    {role.name}
                    {PRIVILEGED.includes(role.name) && <Chip label={t('common.privileged')} size="small" color="warning" />}
                  </Box>
                </TableCell>
                <TableCell>{role.description ?? '—'}</TableCell>
                <TableCell>
                  {PRIVILEGED.includes(role.name)
                    ? <Typography variant="caption" color="text.secondary">{t('roles.allRights')}</Typography>
                    : role.permissions.length > 0
                    ? <Typography variant="caption">{t('roles.permCount', { count: role.permissions.length })}</Typography>
                    : '—'}
                </TableCell>
                <TableCell>{role._count?.users ?? '—'}</TableCell>
                <TableCell align="right">
                  {canUpdate && <Tooltip title={t('common.edit')}><IconButton onClick={() => openEdit(role)} size="small"><EditIcon fontSize="small" /></IconButton></Tooltip>}
                  {canDelete && !PRIVILEGED.includes(role.name) && (
                    <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(role)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 480, p: 3, overflowY: 'auto' }}>
          <Typography variant="h6" gutterBottom>{editRole ? t('roles.editTitle') : t('roles.newTitle')}</Typography>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Box display="flex" flexDirection="column" gap={2}>
            <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} fullWidth required />
            <TextField label={t('common.description')} value={description} onChange={(e) => setDescription(e.target.value)} fullWidth multiline rows={2} />
            <Divider />
            <Typography variant="subtitle1" fontWeight={600}>{t('roles.permissions')}</Typography>
            {permissions && (
              <PermissionCheckboxGrid
                permissions={permissions}
                selected={selectedPermIds}
                onChange={setSelectedPermIds}
              />
            )}
            <Box display="flex" gap={1} justifyContent="flex-end">
              <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="contained" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>{t('common.save')}</Button>
            </Box>
          </Box>
        </Box>
      </Drawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('roles.deleteTitle')}
        message={t('roles.deleteMessage', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => { if (deleteTarget) { await deleteMutation.mutateAsync(deleteTarget.id); setDeleteTarget(null) } }}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />
    </Box>
  )
}
