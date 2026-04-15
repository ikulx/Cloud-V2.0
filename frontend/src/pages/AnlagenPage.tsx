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
import { useNavigate } from 'react-router-dom'
import { useAnlagen, useCreateAnlage, useUpdateAnlage, useDeleteAnlage } from '../features/anlagen/queries'
import { useUsers } from '../features/users/queries'
import { useGroups } from '../features/groups/queries'
import { useDevices } from '../features/devices/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SearchableMultiSelect } from '../components/SearchableMultiSelect'
import { usePermission } from '../hooks/usePermission'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useTranslation } from 'react-i18next'
import type { Anlage } from '../types/model'

const EMPTY_FORM = { name: '', description: '', location: '' }
const EMPTY_ASSIGN = { deviceIds: [] as string[], userIds: [] as string[], groupIds: [] as string[] }

export function AnlagenPage() {
  const { data: anlagen, isLoading } = useAnlagen()
  const { data: allUsers } = useUsers()
  const { data: allGroups } = useGroups()
  const { data: allDevices } = useDevices()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canCreate = usePermission('anlagen:create')
  const canUpdate = usePermission('anlagen:update')
  const canDelete = usePermission('anlagen:delete')

  useDeviceStatus()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const [editAnlage, setEditAnlage] = useState<Anlage | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [deleteTarget, setDeleteTarget] = useState<Anlage | null>(null)
  const [formError, setFormError] = useState('')

  const createMutation = useCreateAnlage()
  const updateMutation = useUpdateAnlage(editAnlage?.id ?? '')
  const deleteMutation = useDeleteAnlage()

  const openCreate = () => {
    setEditAnlage(null)
    setForm(EMPTY_FORM)
    setAssign(EMPTY_ASSIGN)
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const openEdit = (a: Anlage) => {
    setEditAnlage(a)
    setForm({ name: a.name, description: a.description ?? '', location: a.location ?? '' })
    setAssign({
      deviceIds: a.anlageDevices.map((ad) => ad.device.id),
      userIds: a.directUsers.map((du) => du.user.id),
      groupIds: a.groupAnlagen.map((ga) => ga.group.id),
    })
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    setFormError('')
    try {
      const payload = { ...form, ...assign }
      if (editAnlage) await updateMutation.mutateAsync(payload)
      else await createMutation.mutateAsync(payload)
      setDrawerOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  const deviceOptions = (allDevices ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.serialNumber})` }))
  const userOptions = (allUsers ?? []).map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName} (${u.email})` }))
  const groupOptions = (allGroups ?? []).map((g) => ({ id: g.id, label: g.name }))

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('anlagen.title', { count: anlagen?.length ?? 0 })}</Typography>
        {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('anlagen.add')}</Button>}
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>{t('common.description')}</TableCell>
              <TableCell>{t('anlagen.location')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {anlagen?.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('anlagen.empty')}</Typography></TableCell></TableRow>
            )}
            {anlagen?.map((anlage) => (
              <TableRow
                key={anlage.id}
                hover
                onClick={() => navigate(`/anlagen/${anlage.id}`)}
                sx={{ cursor: 'pointer' }}
              >
                <TableCell>{anlage.name}</TableCell>
                <TableCell>{anlage.description ?? '—'}</TableCell>
                <TableCell>{anlage.location ?? '—'}</TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  {canUpdate && <Tooltip title={t('common.edit')}><IconButton onClick={() => openEdit(anlage)} size="small"><EditIcon fontSize="small" /></IconButton></Tooltip>}
                  {canDelete && <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(anlage)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 420, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h6" gutterBottom>{editAnlage ? t('anlagen.editTitle') : t('anlagen.newTitle')}</Typography>
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
                <TextField label={t('common.description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth multiline rows={2} />
                <TextField label={t('anlagen.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} fullWidth />
              </Box>
            )}

            {tab === 1 && (
              <Box display="flex" flexDirection="column" gap={3}>
                <SearchableMultiSelect
                  label={t('nav.devices')}
                  options={deviceOptions}
                  selected={assign.deviceIds}
                  onChange={(ids) => setAssign({ ...assign, deviceIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.users')}
                  options={userOptions}
                  selected={assign.userIds}
                  onChange={(ids) => setAssign({ ...assign, userIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.groups')}
                  options={groupOptions}
                  selected={assign.groupIds}
                  onChange={(ids) => setAssign({ ...assign, groupIds: ids })}
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
        title={t('anlagen.deleteTitle')}
        message={t('anlagen.deleteMessage', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => { if (deleteTarget) { await deleteMutation.mutateAsync(deleteTarget.id); setDeleteTarget(null) } }}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />
    </Box>
  )
}
