import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Paper from '@mui/material/Paper'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import { useTranslation } from 'react-i18next'
import { useActivityLog, type ActivityLogEntry } from '../features/activity-log/queries'
import { formatActionTitle, formatDetails } from '../lib/activity-log-format'

interface Props {
  entityId: string
  /** Limit der angezeigten Einträge (default 100) */
  limit?: number
  /** Compact-Modus ohne Details (nur Titel + Zeit + User) */
  compact?: boolean
}

function actionColor(action: string): 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info' {
  if (action.startsWith('auth.login.failed')) return 'error'
  if (action.startsWith('auth.')) return 'info'
  if (action.endsWith('.delete') || action.includes('.delete')) return 'error'
  if (action.endsWith('.create') || action.includes('.create')) return 'success'
  if (action.endsWith('.update') || action.includes('.update')) return 'primary'
  return 'default'
}

export function EntityActivityLog({ entityId, limit = 100, compact = false }: Props) {
  const { t } = useTranslation()
  const { data, isLoading } = useActivityLog({ entityId, limit })

  if (isLoading) {
    return <Box display="flex" justifyContent="center" py={4}><CircularProgress size={28} /></Box>
  }

  if (!data || data.entries.length === 0) {
    return (
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', py: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">{t('activityLog.empty', 'Keine Einträge')}</Typography>
      </Paper>
    )
  }

  return (
    <Stack spacing={1.5}>
      {data.entries.map((entry) => (
        <EntryCard key={entry.id} entry={entry} compact={compact} />
      ))}
      {data.total > data.entries.length && (
        <Typography variant="caption" color="text.secondary" textAlign="center">
          {t('activityLog.moreAvailable', '… weitere {{count}} Einträge – siehe globales Aktivitätslog', { count: data.total - data.entries.length })}
        </Typography>
      )}
    </Stack>
  )
}

function EntryCard({ entry, compact }: { entry: ActivityLogEntry; compact: boolean }) {
  const { t } = useTranslation()
  const title = formatActionTitle(entry, t)
  const details = compact ? [] : formatDetails(entry, t)
  const time = new Date(entry.createdAt).toLocaleString()
  const who = entry.userEmail ?? t('activityLog.system', 'System')

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: '4px solid',
        borderLeftColor: colorBorder(actionColor(entry.action)),
        p: 1.5,
      }}
    >
      <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
        <Chip
          label={title}
          size="small"
          color={actionColor(entry.action)}
          variant="filled"
          sx={{ fontWeight: 600 }}
        />
        <Typography variant="caption" color="text.secondary">
          {who} · {time}
        </Typography>
        {entry.statusCode && entry.statusCode >= 400 && (
          <Chip label={entry.statusCode} size="small" color="error" sx={{ fontSize: '0.65rem', height: 18 }} />
        )}
      </Box>
      {details.length > 0 && (
        <Box mt={1} display="grid" gridTemplateColumns={{ xs: '1fr', sm: '150px 1fr' }} gap={0.5} sx={{ fontSize: '0.85rem' }}>
          {details.map((d, i) => (
            <Box key={i} sx={{ display: 'contents' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>{d.label}:</Typography>
              <Typography variant="caption" sx={{ wordBreak: 'break-word' }}>{d.value}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  )
}

function colorBorder(c: string): string {
  switch (c) {
    case 'error':    return 'error.main'
    case 'success':  return 'success.main'
    case 'primary':  return 'primary.main'
    case 'info':     return 'info.main'
    case 'warning':  return 'warning.main'
    default:         return 'divider'
  }
}
