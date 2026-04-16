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
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Divider from '@mui/material/Divider'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup } from '../features/groups/queries'
import { useUsers } from '../features/users/queries'
import { useAnlagen } from '../features/anlagen/queries'
import { useDevices } from '../features/devices/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SearchableMultiSelect } from '../components/SearchableMultiSelect'
import { usePermission } from '../hooks/usePermission'
import { useTranslation } from 'react-i18next'
import type { UserGroup } from '../types/model'

const EMPTY_FORM = { name: '', description: '' }
const EMPTY_ASSIGN = { userIds: [] as string[], anlageIds: [] as string[], deviceIds: [] as string[] }

export function GroupsPage() {
  const { data: groups, isLoading } = useGroups()
  const { data: allUsers } = useUsers()
  const { data: allAnlagen } = useAnlagen()
  const { data: allDevices } = useDevices()
  const { t } = useTranslation()
  const canCreate = usePermission('groups:create')
  const canUpdate = usePermission('groups:update')
  const canDelete = usePermission('groups:delete')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const [editGroup, setEditGroup] = useState<UserGroup | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [deleteTarget, setDeleteTarget] = useState<UserGroup | null>(null)
  const [formError, setFormError] = useState('')

  const createMutation = useCreateGroup()
  const updateMutation = useUpdateGroup(editGroup?.id ?? '')
  const deleteMutation = useDeleteGroup()

  const openCreate = () => {
    setEditGroup(null)
    setForm(EMPTY_FORM)
    setAssign(EMPTY_ASSIGN)
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const openEdit = (g: UserGroup) => {
    setEditGroup(g)
    setForm({ name: g.name, description: g.description ?? '' })
    setAssign({
      userIds: g.members.map((m) => m.user.id),
      anlageIds: g.groupAnlagen.map((a) => a.anlage.id),
      deviceIds: g.groupDevices.map((d) => d.device.id),
    })
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    setFormError('')
    try {
      const payload = { ...form, ...assign }
      if (editGroup) await updateMutation.mutateAsync(payload)
      else await createMutation.mutateAsync(payload)
      setDrawerOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  const userOptions = (allUsers ?? []).map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName} (${u.email})` }))
  const anlageOptions = (allAnlagen ?? []).map((a) => ({ id: a.id, label: a.name }))
  const deviceOptions = (allDevices ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.serialNumber})` }))

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('groups.title', { count: groups?.length ?? 0 })}</Typography>
        {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('groups.create')}</Button>}
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>{t('common.description')}</TableCell>
              <TableCell>{t('groups.members')}</TableCell>
              <TableCell>{t('nav.anlagen')}</TableCell>
              <TableCell>{t('nav.devices')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groups?.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('groups.empty')}</Typography></TableCell></TableRow>
            )}
            {groups?.map((group) => (
              <TableRow key={group.id} hover>
                <TableCell>{group.name}</TableCell>
                <TableCell>{group.description ?? '—'}</TableCell>
                <TableCell>{group._count?.members ?? group.members.length}</TableCell>
                <TableCell>{group.groupAnlagen.length}</TableCell>
                <TableCell>{group.groupDevices.length}</TableCell>
                <TableCell align="right">
                  {canUpdate && <Tooltip title={t('common.edit')}><IconButton onClick={() => openEdit(group)} size="small"><EditIcon fontSize="small" /></IconButton></Tooltip>}
                  {canDelete && <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(group)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: '100vw', sm: 420 }, maxWidth: '100vw', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h6" gutterBottom>{editGroup ? t('groups.editTitle') : t('groups.newTitle')}</Typography>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tab label={t('common.basicData')} />
              <Tab label={t('common.assignments')} />
            </Tabs>
          </Box>

          <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

            {tab === 0 && (
              <Box display="flex" flexDirection="column" gap={2}>
                <TextField label={t('common.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth required />
                <TextField label={t('common.description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={3} />
              </Box>
            )}

            {tab === 1 && (
              <Box display="flex" flexDirection="column" gap={3}>
                <SearchableMultiSelect
                  label={t('nav.users')}
                  options={userOptions}
                  selected={assign.userIds}
                  onChange={(ids) => setAssign({ ...assign, userIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.anlagen')}
                  options={anlageOptions}
                  selected={assign.anlageIds}
                  onChange={(ids) => setAssign({ ...assign, anlageIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.devices')}
                  options={deviceOptions}
                  selected={assign.deviceIds}
                  onChange={(ids) => setAssign({ ...assign, deviceIds: ids })}
                />
              </Box>
            )}
          </Box>

          <Box sx={{ p: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box display="flex" gap={1} justifyContent="flex-end">
              <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="contained" onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>{t('common.save')}</Button>
            </Box>
          </Box>
        </Box>
      </Drawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('groups.deleteTitle')}
        message={t('groups.deleteMessage', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => { if (deleteTarget) { await deleteMutation.mutateAsync(deleteTarget.id); setDeleteTarget(null) } }}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />
    </Box>
  )
}
