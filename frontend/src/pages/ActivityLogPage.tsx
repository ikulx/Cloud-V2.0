import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Pagination from '@mui/material/Pagination'
import Tooltip from '@mui/material/Tooltip'
import { useTranslation } from 'react-i18next'
import { useActivityLog } from '../features/activity-log/queries'

function actionColor(action: string): 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info' {
  if (action.startsWith('auth.login.failed')) return 'error'
  if (action.startsWith('auth.')) return 'info'
  if (action.endsWith('.delete')) return 'error'
  if (action.endsWith('.create')) return 'success'
  if (action.endsWith('.update')) return 'primary'
  return 'default'
}

const PAGE_SIZE = 50

export function ActivityLogPage() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [appliedFilter, setAppliedFilter] = useState('')

  const { data, isLoading, isFetching } = useActivityLog({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    action: appliedFilter || undefined,
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('activityLog.title', 'Aktivitätslog')}</Typography>
        {isFetching && <CircularProgress size={20} />}
      </Box>

      <Box display="flex" gap={1} mb={2}>
        <TextField
          label={t('activityLog.filterAction', 'Action-Filter (z.B. anlagen oder anlagen.create)')}
          size="small"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          sx={{ flexGrow: 1, maxWidth: 400 }}
          onKeyDown={(e) => { if (e.key === 'Enter') { setAppliedFilter(actionFilter.trim()); setPage(1) } }}
        />
        <Button
          variant="outlined"
          onClick={() => { setAppliedFilter(actionFilter.trim()); setPage(1) }}
        >
          {t('common.search', 'Suchen')}
        </Button>
        {appliedFilter && (
          <Button onClick={() => { setActionFilter(''); setAppliedFilter(''); setPage(1) }}>
            {t('common.cancel')}
          </Button>
        )}
      </Box>

      {isLoading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : (
        <>
          <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 170 }}>{t('activityLog.time', 'Zeitpunkt')}</TableCell>
                  <TableCell sx={{ width: 200 }}>{t('activityLog.user', 'Benutzer')}</TableCell>
                  <TableCell sx={{ width: 220 }}>{t('activityLog.action', 'Aktion')}</TableCell>
                  <TableCell>{t('activityLog.entity', 'Entität')}</TableCell>
                  <TableCell sx={{ width: 60 }}>{t('activityLog.status', 'Status')}</TableCell>
                  <TableCell sx={{ width: 130 }}>{t('activityLog.ip', 'IP')}</TableCell>
                  <TableCell>{t('activityLog.details', 'Details')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">{t('activityLog.empty', 'Keine Einträge')}</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {data?.entries.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell>
                      <Tooltip title={new Date(e.createdAt).toLocaleString()}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                          {new Date(e.createdAt).toLocaleString()}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{e.userEmail ?? '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={e.action}
                        size="small"
                        color={actionColor(e.action)}
                        sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                      />
                    </TableCell>
                    <TableCell>
                      {e.entityType && (
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                          {e.entityType}{e.entityId ? ` · ${e.entityId.slice(0, 8)}…` : ''}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.statusCode && (
                        <Chip
                          label={e.statusCode}
                          size="small"
                          color={e.statusCode >= 400 ? 'error' : e.statusCode >= 300 ? 'warning' : 'default'}
                          sx={{ fontSize: '0.65rem', height: 18 }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{e.ipAddress ?? '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      {e.details && (
                        <Tooltip title={<pre style={{ margin: 0, fontSize: 11 }}>{JSON.stringify(e.details, null, 2)}</pre>}>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', cursor: 'help' }}>
                            {JSON.stringify(e.details).slice(0, 80)}
                            {JSON.stringify(e.details).length > 80 ? '…' : ''}
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {data && totalPages > 1 && (
            <Box display="flex" justifyContent="center" mt={2}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setPage(p)}
                color="primary"
                size="small"
              />
            </Box>
          )}

          {data && (
            <Typography variant="caption" color="text.secondary" display="block" textAlign="center" mt={1}>
              {t('activityLog.totalEntries', 'Gesamt: {{count}} Einträge', { count: data.total })}
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}
