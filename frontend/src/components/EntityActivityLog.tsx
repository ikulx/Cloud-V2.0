import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Paper from '@mui/material/Paper'
import CircularProgress from '@mui/material/CircularProgress'
import { useTranslation } from 'react-i18next'
import { useActivityLog } from '../features/activity-log/queries'
import { ActivityTable } from './ActivityTable'

interface Props {
  /** Filter: nur Einträge die DIESE Entität betreffen (Standard). */
  entityId?: string
  /** Filter: nur Einträge die DIESER Benutzer ausgelöst hat. */
  userId?: string
  /** Limit der angezeigten Einträge (default 100) */
  limit?: number
}

/**
 * Zeigt Activity-Log-Einträge für eine Entität ODER für einen Benutzer.
 * - entityId: Änderungen AN der Entität (z.B. "Anlage bearbeitet")
 * - userId: Änderungen DURCH den Benutzer (z.B. Benutzer X hat Anlage Y bearbeitet)
 */
export function EntityActivityLog({ entityId, userId, limit = 100 }: Props) {
  const { t } = useTranslation()
  const { data, isLoading } = useActivityLog({ entityId, userId, limit })

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
    <Box>
      <ActivityTable entries={data.entries} />
      {data.total > data.entries.length && (
        <Typography variant="caption" color="text.secondary" textAlign="center" display="block" mt={1}>
          {t('activityLog.moreAvailable', '… weitere {{count}} Einträge – siehe globales Aktivitätslog', { count: data.total - data.entries.length })}
        </Typography>
      )}
    </Box>
  )
}
