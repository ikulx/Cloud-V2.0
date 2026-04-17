import { useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import CircularProgress from '@mui/material/CircularProgress'
import Pagination from '@mui/material/Pagination'
import Stack from '@mui/material/Stack'
import { useTranslation } from 'react-i18next'
import { useActivityLog } from '../features/activity-log/queries'
import { ActivityCard } from '../components/ActivityCard'

const PAGE_SIZE = 30

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
          label={t('activityLog.filterAction', 'Filter (z.B. anlagen oder anlagen.create)')}
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
      ) : data?.entries.length === 0 ? (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', py: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('activityLog.empty', 'Keine Einträge')}</Typography>
        </Paper>
      ) : (
        <>
          <Stack spacing={1.25}>
            {data?.entries.map((entry) => (
              <ActivityCard key={entry.id} entry={entry} />
            ))}
          </Stack>

          {data && totalPages > 1 && (
            <Box display="flex" justifyContent="center" mt={3}>
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
