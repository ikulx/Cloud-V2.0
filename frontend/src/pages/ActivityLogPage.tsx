import { useState, useMemo } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Paper from '@mui/material/Paper'
import CircularProgress from '@mui/material/CircularProgress'
import Pagination from '@mui/material/Pagination'
import Stack from '@mui/material/Stack'
import Chip from '@mui/material/Chip'
import Autocomplete from '@mui/material/Autocomplete'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import { useTranslation } from 'react-i18next'
import { useActivityLog, useActivityLogUsers, type ActivityCategory } from '../features/activity-log/queries'
import { ActivityTable } from '../components/ActivityTable'

type DateRange = 'today' | '7d' | '30d' | 'all'

const PAGE_SIZE = 100

function dateRangeToIso(range: DateRange): { startDate?: string } {
  if (range === 'all') return {}
  const now = new Date()
  const start = new Date(now)
  if (range === 'today') {
    start.setHours(0, 0, 0, 0)
  } else if (range === '7d') {
    start.setDate(start.getDate() - 7)
  } else if (range === '30d') {
    start.setDate(start.getDate() - 30)
  }
  return { startDate: start.toISOString() }
}

export function ActivityLogPage() {
  const { t } = useTranslation()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ActivityCategory | 'all'>('all')
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [userFilter, setUserFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const dateQuery = useMemo(() => dateRangeToIso(dateRange), [dateRange])
  const { data: users } = useActivityLogUsers()

  const { data, isLoading, isFetching } = useActivityLog({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search: search.trim() || undefined,
    category: category === 'all' ? undefined : category,
    userEmail: userFilter ?? undefined,
    ...dateQuery,
    sort,
  })
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  const hasAnyFilter = search || category !== 'all' || dateRange !== '7d' || userFilter
  const resetAll = () => {
    setSearch('')
    setCategory('all')
    setDateRange('7d')
    setUserFilter(null)
    setSort('desc')
    setPage(1)
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">{t('activityLog.title', 'Aktivitätslog')}</Typography>
        <Box display="flex" alignItems="center" gap={1}>
          {isFetching && <CircularProgress size={18} />}
          <Typography variant="caption" color="text.secondary">
            {data && t('activityLog.totalEntries', 'Gesamt: {{count}} Einträge', { count: data.total })}
          </Typography>
        </Box>
      </Box>

      {/* Filter-Bar */}
      <Paper
        elevation={0}
        sx={{ border: '1px solid', borderColor: 'divider', p: 2, mb: 2 }}
      >
        {/* Kategorie-Chips */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={1.5}>
          <CategoryChip label={t('activityLog.cat.all', 'Alle')}            value="all"      current={category} onClick={setCategory} resetPage={() => setPage(1)} />
          <CategoryChip label={t('activityLog.cat.changes', 'Änderungen')}  value="changes"  current={category} onClick={setCategory} resetPage={() => setPage(1)} />
          <CategoryChip label={t('activityLog.cat.remote', 'Fernzugriff')}  value="remote"   current={category} onClick={setCategory} resetPage={() => setPage(1)} />
          <CategoryChip label={t('activityLog.cat.login', 'Anmeldung')}     value="login"    current={category} onClick={setCategory} resetPage={() => setPage(1)} />
          <CategoryChip label={t('activityLog.cat.security', 'Sicherheit')} value="security" current={category} onClick={setCategory} resetPage={() => setPage(1)} />
          <CategoryChip label={t('activityLog.cat.system', 'System')}       value="system"   current={category} onClick={setCategory} resetPage={() => setPage(1)} />
        </Stack>

        {/* Zeitraum + Sortierung */}
        <Box display="flex" alignItems="center" gap={2} mb={1.5} flexWrap="wrap">
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            <DateChip label={t('activityLog.range.today', 'Heute')}  value="today" current={dateRange} onClick={(v) => { setDateRange(v); setPage(1) }} />
            <DateChip label={t('activityLog.range.7d', '7 Tage')}    value="7d"    current={dateRange} onClick={(v) => { setDateRange(v); setPage(1) }} />
            <DateChip label={t('activityLog.range.30d', '30 Tage')}  value="30d"   current={dateRange} onClick={(v) => { setDateRange(v); setPage(1) }} />
            <DateChip label={t('activityLog.range.all', 'Alle')}     value="all"   current={dateRange} onClick={(v) => { setDateRange(v); setPage(1) }} />
          </Stack>

          <Box flexGrow={1} />

          <Tooltip title={sort === 'desc' ? t('activityLog.sortNewest', 'Neueste zuerst') : t('activityLog.sortOldest', 'Älteste zuerst')}>
            <IconButton
              size="small"
              onClick={() => { setSort((s) => (s === 'desc' ? 'asc' : 'desc')); setPage(1) }}
            >
              {sort === 'desc' ? <ArrowDownwardIcon fontSize="small" /> : <ArrowUpwardIcon fontSize="small" />}
            </IconButton>
          </Tooltip>

          {hasAnyFilter && (
            <Tooltip title={t('activityLog.resetFilters', 'Filter zurücksetzen')}>
              <IconButton size="small" onClick={resetAll}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Suche + User-Filter */}
        <Box display="flex" gap={1} flexWrap="wrap">
          <TextField
            label={t('activityLog.search', 'Suchen (Action, User, Entity-ID)')}
            size="small"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            sx={{ flexGrow: 1, minWidth: 200 }}
          />
          <Autocomplete
            size="small"
            options={users?.map((u) => u.userEmail ?? '').filter(Boolean) ?? []}
            value={userFilter}
            onChange={(_, v) => { setUserFilter(v); setPage(1) }}
            renderInput={(params) => <TextField {...params} label={t('activityLog.userFilter', 'Benutzer')} />}
            sx={{ minWidth: 240 }}
          />
        </Box>
      </Paper>

      {/* Ergebnisse */}
      {isLoading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : data?.entries.length === 0 ? (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', py: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('activityLog.empty', 'Keine Einträge')}</Typography>
        </Paper>
      ) : (
        <ActivityTable entries={data?.entries ?? []} />
      )}

      {/* Pagination */}
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
    </Box>
  )
}

interface CategoryChipProps {
  label: string
  value: ActivityCategory | 'all'
  current: ActivityCategory | 'all'
  onClick: (v: ActivityCategory | 'all') => void
  resetPage: () => void
}
function CategoryChip({ label, value, current, onClick, resetPage }: CategoryChipProps) {
  const active = current === value
  return (
    <Chip
      label={label}
      onClick={() => { onClick(value); resetPage() }}
      color={active ? 'primary' : 'default'}
      variant={active ? 'filled' : 'outlined'}
      size="small"
      sx={{ fontWeight: active ? 600 : 400 }}
    />
  )
}

interface DateChipProps {
  label: string
  value: DateRange
  current: DateRange
  onClick: (v: DateRange) => void
}
function DateChip({ label, value, current, onClick }: DateChipProps) {
  const active = current === value
  return (
    <Chip
      label={label}
      onClick={() => onClick(value)}
      color={active ? 'primary' : 'default'}
      variant={active ? 'filled' : 'outlined'}
      size="small"
      sx={{ fontWeight: active ? 600 : 400 }}
    />
  )
}
