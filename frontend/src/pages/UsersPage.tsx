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
import MenuItem from '@mui/material/MenuItem'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Divider from '@mui/material/Divider'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import ReplayIcon from '@mui/icons-material/Replay'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import HistoryIcon from '@mui/icons-material/History'
import { EntityActivityLog } from '../components/EntityActivityLog'
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser } from '../features/users/queries'
import { useInvitations, useCreateInvitation, useResendInvitation, useDeleteInvitation } from '../features/invitations/queries'
import { useRoles } from '../features/roles/queries'
import { useGroups } from '../features/groups/queries'
import { useAnlagen } from '../features/anlagen/queries'
import { useDevices } from '../features/devices/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SearchableMultiSelect } from '../components/SearchableMultiSelect'
import { usePermission } from '../hooks/usePermission'
import { useTranslation } from 'react-i18next'
import type { UserSummary } from '../types/model'

const EMPTY_FORM = { email: '', password: '', firstName: '', lastName: '', address: '', roleId: '', isActive: true }
const EMPTY_ASSIGN = { groupIds: [] as string[], anlageIds: [] as string[], deviceIds: [] as string[] }

export function UsersPage() {
  const { data: users, isLoading } = useUsers()
  const { data: roles } = useRoles()
  const { data: allGroups } = useGroups()
  const { data: allAnlagen } = useAnlagen()
  const { data: allDevices } = useDevices()
  const { t } = useTranslation()
  const canCreate = usePermission('users:create')
  const canUpdate = usePermission('users:update')
  const canDelete = usePermission('users:delete')
  const canReadActivityLog = usePermission('activityLog:read')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [tab, setTab] = useState(0)
  const [editUser, setEditUser] = useState<UserSummary | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [assign, setAssign] = useState(EMPTY_ASSIGN)
  const [deleteTarget, setDeleteTarget] = useState<UserSummary | null>(null)
  const [formError, setFormError] = useState('')

  const createMutation = useCreateUser()
  const updateMutation = useUpdateUser(editUser?.id ?? '')
  const deleteMutation = useDeleteUser()

  // Einladungen
  const { data: invitations } = useInvitations()
  const createInvite = useCreateInvitation()
  const resendInvite = useResendInvitation()
  const deleteInvite = useDeleteInvitation()
  const [inviteDrawerOpen, setInviteDrawerOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', roleId: '' })
  const [inviteAssign, setInviteAssign] = useState({ groupIds: [] as string[], anlageIds: [] as string[], deviceIds: [] as string[] })
  const [inviteTab, setInviteTab] = useState(0)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [deleteInviteTarget, setDeleteInviteTarget] = useState<string | null>(null)

  const openInvite = () => {
    setInviteForm({ email: '', roleId: '' })
    setInviteAssign({ groupIds: [], anlageIds: [], deviceIds: [] })
    setInviteError('')
    setInviteSuccess('')
    setInviteTab(0)
    setInviteDrawerOpen(true)
  }

  const handleInvite = async () => {
    setInviteError('')
    setInviteSuccess('')
    try {
      const result = await createInvite.mutateAsync({
        email: inviteForm.email,
        roleId: inviteForm.roleId || null,
        ...inviteAssign,
      })
      setInviteSuccess(`Einladung an ${result.email} gesendet.`)
      setInviteForm({ email: '', roleId: '' })
      setInviteAssign({ groupIds: [], anlageIds: [], deviceIds: [] })
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Einladung fehlgeschlagen')
    }
  }

  const pendingInvitations = (invitations ?? []).filter((i) => !i.usedAt)

  const openCreate = () => {
    setEditUser(null)
    setForm(EMPTY_FORM)
    setAssign(EMPTY_ASSIGN)
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const openEdit = (u: UserSummary) => {
    setEditUser(u)
    setForm({ email: u.email, password: '', firstName: u.firstName, lastName: u.lastName, address: u.address ?? '', roleId: u.roleId ?? '', isActive: u.isActive })
    setAssign({
      groupIds: u.groupMemberships.map((gm) => gm.group.id),
      anlageIds: u.directAnlagen.map((da) => da.anlage.id),
      deviceIds: u.directDevices.map((dd) => dd.device.id),
    })
    setFormError('')
    setTab(0)
    setDrawerOpen(true)
  }

  const handleSave = async () => {
    setFormError('')
    try {
      const data: Record<string, unknown> = { ...form, ...assign, roleId: form.roleId || null }
      if (!editUser) {
        // new user requires password
      } else if (!form.password) {
        delete data.password
      }
      if (editUser) await updateMutation.mutateAsync(data)
      else await createMutation.mutateAsync(data)
      setDrawerOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('common.errorSaving'))
    }
  }

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  const groupOptions = (allGroups ?? []).map((g) => ({ id: g.id, label: g.name }))
  const anlageOptions = (allAnlagen ?? []).map((a) => ({ id: a.id, label: a.name }))
  const deviceOptions = (allDevices ?? []).map((d) => ({ id: d.id, label: `${d.name} (${d.serialNumber})` }))

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('users.title', { count: users?.length ?? 0 })}</Typography>
        <Box display="flex" gap={1}>
          {canCreate && <Button variant="outlined" startIcon={<MailOutlineIcon />} onClick={openInvite}>Einladen</Button>}
          {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('users.create')}</Button>}
        </Box>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>{t('common.email')}</TableCell>
              <TableCell>{t('common.role')}</TableCell>
              <TableCell>{t('users.groups')}</TableCell>
              <TableCell>{t('common.status')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users?.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('users.empty')}</Typography></TableCell></TableRow>
            )}
            {users?.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell>{user.firstName} {user.lastName}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.role ? <Chip label={user.role.name} size="small" /> : '—'}</TableCell>
                <TableCell>{user.groupMemberships.map((gm) => gm.group.name).join(', ') || '—'}</TableCell>
                <TableCell><Chip label={user.isActive ? t('common.active') : t('common.inactive')} color={user.isActive ? 'success' : 'default'} size="small" /></TableCell>
                <TableCell align="right">
                  {canUpdate && <Tooltip title={t('common.edit')}><IconButton onClick={() => openEdit(user)} size="small"><EditIcon fontSize="small" /></IconButton></Tooltip>}
                  {canDelete && <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(user)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: '100vw', sm: 420 }, maxWidth: '100vw', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h6" gutterBottom>{editUser ? t('users.editTitle') : t('users.newTitle')}</Typography>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tab label={t('common.basicData')} />
              <Tab label={t('common.assignments')} />
              {editUser && canReadActivityLog && (
                <Tab icon={<HistoryIcon fontSize="small" />} iconPosition="start" label={t('activityLog.tab', 'Aktivität')} />
              )}
            </Tabs>
          </Box>

          <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

            {tab === 0 && (
              <Box display="flex" flexDirection="column" gap={2}>
                <TextField label={t('users.firstName')} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} fullWidth required />
                <TextField label={t('users.lastName')} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} fullWidth required />
                <TextField label={t('common.email')} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} fullWidth required />
                <TextField label={editUser ? t('users.passwordEdit') : t('users.password')} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} fullWidth required={!editUser} />
                <TextField label={t('users.address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} fullWidth />
                <TextField select label={t('common.role')} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} fullWidth>
                  <MenuItem value="">{t('common.noRole')}</MenuItem>
                  {roles?.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
                </TextField>
                {editUser && <FormControlLabel control={<Switch checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />} label={t('common.active')} />}
              </Box>
            )}

            {tab === 1 && (
              <Box display="flex" flexDirection="column" gap={3}>
                <SearchableMultiSelect
                  label={t('nav.groups')}
                  options={groupOptions}
                  selected={assign.groupIds}
                  onChange={(ids) => setAssign({ ...assign, groupIds: ids })}
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

            {tab === 2 && editUser && canReadActivityLog && (
              <EntityActivityLog entityId={editUser.id} limit={50} />
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

      {/* Offene Einladungen */}
      {canCreate && pendingInvitations.length > 0 && (
        <Box mt={4}>
          <Typography variant="h6" mb={2}>Offene Einladungen ({pendingInvitations.length})</Typography>
          <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>E-Mail</TableCell>
                  <TableCell>Eingeladen von</TableCell>
                  <TableCell>Gültig bis</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingInvitations.map((inv) => {
                  const isExpired = new Date(inv.expiresAt) < new Date()
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.email}</TableCell>
                      <TableCell>{inv.invitedBy.firstName} {inv.invitedBy.lastName}</TableCell>
                      <TableCell>{new Date(inv.expiresAt).toLocaleDateString('de-DE')}</TableCell>
                      <TableCell>
                        <Chip
                          label={isExpired ? 'Abgelaufen' : 'Ausstehend'}
                          color={isExpired ? 'error' : 'warning'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Link kopieren">
                          <IconButton size="small" onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`)
                          }}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Erneut senden">
                          <IconButton size="small" onClick={() => resendInvite.mutate(inv.id)}>
                            <ReplayIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('common.delete')}>
                          <IconButton size="small" color="error" onClick={() => setDeleteInviteTarget(inv.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {/* Einladungs-Drawer */}
      <Drawer anchor="right" open={inviteDrawerOpen} onClose={() => setInviteDrawerOpen(false)}>
        <Box sx={{ width: { xs: '100vw', sm: 420 }, maxWidth: '100vw', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={{ p: 3, pb: 0 }}>
            <Typography variant="h6" gutterBottom>Benutzer einladen</Typography>
            <Tabs value={inviteTab} onChange={(_, v) => setInviteTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tab label="E-Mail & Rolle" />
              <Tab label={t('common.assignments')} />
            </Tabs>
          </Box>

          <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
            {inviteError && <Alert severity="error" sx={{ mb: 2 }}>{inviteError}</Alert>}
            {inviteSuccess && <Alert severity="success" sx={{ mb: 2 }}>{inviteSuccess}</Alert>}

            {inviteTab === 0 && (
              <Box display="flex" flexDirection="column" gap={2}>
                <TextField
                  label="E-Mail-Adresse"
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  fullWidth
                  required
                  helperText="Der Benutzer erhält eine E-Mail mit einem Registrierungslink."
                />
                <TextField
                  select
                  label={t('common.role')}
                  value={inviteForm.roleId}
                  onChange={(e) => setInviteForm({ ...inviteForm, roleId: e.target.value })}
                  fullWidth
                >
                  <MenuItem value="">{t('common.noRole')}</MenuItem>
                  {roles?.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
                </TextField>
              </Box>
            )}

            {inviteTab === 1 && (
              <Box display="flex" flexDirection="column" gap={3}>
                <SearchableMultiSelect
                  label={t('nav.groups')}
                  options={groupOptions}
                  selected={inviteAssign.groupIds}
                  onChange={(ids) => setInviteAssign({ ...inviteAssign, groupIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.anlagen')}
                  options={anlageOptions}
                  selected={inviteAssign.anlageIds}
                  onChange={(ids) => setInviteAssign({ ...inviteAssign, anlageIds: ids })}
                />
                <Divider />
                <SearchableMultiSelect
                  label={t('nav.devices')}
                  options={deviceOptions}
                  selected={inviteAssign.deviceIds}
                  onChange={(ids) => setInviteAssign({ ...inviteAssign, deviceIds: ids })}
                />
              </Box>
            )}
          </Box>

          <Box sx={{ p: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box display="flex" gap={1} justifyContent="flex-end">
              <Button onClick={() => setInviteDrawerOpen(false)}>{t('common.cancel')}</Button>
              <Button
                variant="contained"
                startIcon={<MailOutlineIcon />}
                onClick={handleInvite}
                disabled={!inviteForm.email || createInvite.isPending}
              >
                Einladung senden
              </Button>
            </Box>
          </Box>
        </Box>
      </Drawer>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('users.deleteTitle')}
        message={t('users.deleteMessage', { name: `${deleteTarget?.firstName} ${deleteTarget?.lastName}` })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => { if (deleteTarget) { await deleteMutation.mutateAsync(deleteTarget.id); setDeleteTarget(null) } }}
        onClose={() => setDeleteTarget(null)}
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={!!deleteInviteTarget}
        title="Einladung widerrufen"
        message="Soll diese Einladung wirklich gelöscht werden?"
        confirmLabel={t('common.delete')}
        onConfirm={async () => { if (deleteInviteTarget) { await deleteInvite.mutateAsync(deleteInviteTarget); setDeleteInviteTarget(null) } }}
        onClose={() => setDeleteInviteTarget(null)}
        loading={deleteInvite.isPending}
      />
    </Box>
  )
}
