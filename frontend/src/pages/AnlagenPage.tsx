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
import Tooltip from '@mui/material/Tooltip'
import Chip from '@mui/material/Chip'
import AddIcon from '@mui/icons-material/Add'
import MapIcon from '@mui/icons-material/Map'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import WarningIcon from '@mui/icons-material/Warning'
import AssignmentLateIcon from '@mui/icons-material/AssignmentLate'
import { useNavigate } from 'react-router-dom'
import { useAnlagen, useDeleteAnlage } from '../features/anlagen/queries'
import { useUsers } from '../features/users/queries'
import { useGroups } from '../features/groups/queries'
import { useDevices } from '../features/devices/queries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AnlageCreateWizard } from '../components/AnlageCreateWizard'
import { usePermission } from '../hooks/usePermission'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useTranslation } from 'react-i18next'
import type { Anlage, Device } from '../types/model'

type AnlageStatus = 'OK' | 'TODO' | 'ERROR' | 'OFFLINE' | 'EMPTY'

function computeAnlageStatus(devices: Device[]): AnlageStatus {
  if (devices.length === 0) return 'EMPTY'
  // Priorität: OFFLINE > ERROR > TODO > OK
  const hasOffline = devices.some((d) => d.status !== 'ONLINE')
  if (hasOffline) return 'OFFLINE'
  const hasError = devices.some((d) => d.hasError === true)
  if (hasError) return 'ERROR'
  const hasTodos = devices.some((d) => (d._count?.todos ?? 0) > 0)
  if (hasTodos) return 'TODO'
  return 'OK'
}

function StatusChip({ status }: { status: AnlageStatus }) {
  switch (status) {
    case 'OK':
      return <Chip icon={<CheckCircleIcon />} label="OK" color="success" size="small" sx={{ fontWeight: 600 }} />
    case 'TODO':
      return <Chip icon={<AssignmentLateIcon />} label="Todos offen" color="warning" size="small" sx={{ fontWeight: 600 }} />
    case 'ERROR':
      return <Chip icon={<WarningIcon />} label="Fehler" color="warning" size="small" sx={{ fontWeight: 600, bgcolor: 'warning.dark', color: 'common.white' }} />
    case 'OFFLINE':
      return <Chip icon={<ErrorIcon />} label="Offline" color="error" size="small" sx={{ fontWeight: 600 }} />
    case 'EMPTY':
      return <Chip label="—" size="small" variant="outlined" />
  }
}

export function AnlagenPage() {
  const { data: anlagen, isLoading } = useAnlagen()
  const { data: allUsers } = useUsers()
  const { data: allGroups } = useGroups()
  const { data: allDevices } = useDevices()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const canCreate = usePermission('anlagen:create')
  const canDelete = usePermission('anlagen:delete')

  useDeviceStatus()

  const [wizardOpen, setWizardOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Anlage | null>(null)

  const deleteMutation = useDeleteAnlage()

  if (isLoading) return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>

  const deviceOptions = (allDevices ?? []).map((d) => ({ id: d.id, label: `${d.name || d.serialNumber} (${d.serialNumber})` }))
  const userOptions = (allUsers ?? []).map((u) => ({ id: u.id, label: `${u.firstName} ${u.lastName} (${u.email})` }))
  const groupOptions = (allGroups ?? []).map((g) => ({ id: g.id, label: g.name }))

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('anlagen.title', { count: anlagen?.length ?? 0 })}</Typography>
        <Box display="flex" gap={1}>
          <Button variant="outlined" startIcon={<MapIcon />} onClick={() => navigate('/anlagen/map')}>Karte</Button>
          {canCreate && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizardOpen(true)}>{t('anlagen.add')}</Button>}
        </Box>
      </Box>

      <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 140 }}>{t('common.status')}</TableCell>
              <TableCell>Projekt-Nr.</TableCell>
              <TableCell>{t('common.name')}</TableCell>
              <TableCell>Ort</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {anlagen?.length === 0 && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">{t('anlagen.empty')}</Typography></TableCell></TableRow>

            )}
            {anlagen?.map((anlage) => {
              const deviceIdSet = new Set(anlage.anlageDevices.map((ad) => ad.device.id))
              const anlageDevices = (allDevices ?? []).filter((d) => deviceIdSet.has(d.id))
              const status = computeAnlageStatus(anlageDevices)
              return (
                <TableRow
                  key={anlage.id}
                  hover
                  onClick={() => navigate(`/anlagen/${anlage.id}`)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell><StatusChip status={status} /></TableCell>
                  <TableCell>{anlage.projectNumber ?? '—'}</TableCell>
                  <TableCell>{anlage.name}</TableCell>
                  <TableCell>{anlage.city ?? '—'}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {canDelete && <Tooltip title={t('common.delete')}><IconButton onClick={() => setDeleteTarget(anlage)} size="small" color="error"><DeleteIcon fontSize="small" /></IconButton></Tooltip>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <AnlageCreateWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        deviceOptions={deviceOptions}
        userOptions={userOptions}
        groupOptions={groupOptions}
      />

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
