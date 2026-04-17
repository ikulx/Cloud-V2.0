import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import { useTranslation } from 'react-i18next'
import type { ActivityLogEntry } from '../features/activity-log/queries'
import {
  formatActionTitle,
  formatChanges,
  formatDetails,
  actionColor,
} from '../lib/activity-log-format'

interface Props {
  entries: ActivityLogEntry[]
}

export function ActivityTable({ entries }: Props) {
  const { t } = useTranslation()

  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Table size="small" sx={{ '& td': { verticalAlign: 'top' } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 140 }}>{t('activityLog.time', 'Zeit')}</TableCell>
            <TableCell sx={{ width: 200 }}>{t('activityLog.user', 'Benutzer')}</TableCell>
            <TableCell>{t('activityLog.actionCol', 'Aktion')}</TableCell>
            <TableCell>{t('activityLog.changesCol', 'Änderungen')}</TableCell>
            <TableCell sx={{ width: 60 }}>{t('activityLog.status', 'Status')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((entry) => (
            <Row key={entry.id} entry={entry} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function Row({ entry }: { entry: ActivityLogEntry }) {
  const { t } = useTranslation()
  const title = formatActionTitle(entry, t)
  const changes = formatChanges(entry, t)
  const details = formatDetails(entry, t)
  const color = actionColor(entry.action)
  const isError = entry.statusCode && entry.statusCode >= 400
  const date = new Date(entry.createdAt)

  return (
    <TableRow hover>
      {/* Zeit */}
      <TableCell>
        <Tooltip title={date.toLocaleString()}>
          <Box>
            <Typography variant="caption" sx={{ display: 'block', fontFamily: 'monospace' }}>
              {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              {date.toLocaleDateString()}
            </Typography>
          </Box>
        </Tooltip>
      </TableCell>

      {/* User */}
      <TableCell>
        <Typography variant="caption">
          {entry.userEmail ?? t('activityLog.system', 'System')}
        </Typography>
        {entry.ipAddress && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem', fontFamily: 'monospace' }}>
            {entry.ipAddress}
          </Typography>
        )}
      </TableCell>

      {/* Action */}
      <TableCell>
        <Chip
          label={title}
          size="small"
          color={color}
          variant="filled"
          sx={{ fontWeight: 500, maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal' } }}
        />
      </TableCell>

      {/* Änderungen / Details – kompakt mehrzeilig */}
      <TableCell>
        {changes.length > 0 && (
          <Box sx={{ fontSize: '0.75rem' }}>
            {changes.slice(0, 4).map((c, i) => (
              <Box key={i} display="flex" gap={0.5} alignItems="baseline" flexWrap="wrap">
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 70 }}>
                  {c.label}:
                </Typography>
                <Typography variant="caption" sx={{ textDecoration: 'line-through', opacity: 0.6, fontFamily: 'monospace' }}>
                  {c.from}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>→</Typography>
                <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600, fontFamily: 'monospace' }}>
                  {c.to}
                </Typography>
              </Box>
            ))}
            {changes.length > 4 && (
              <Typography variant="caption" color="text.secondary">+{changes.length - 4} …</Typography>
            )}
          </Box>
        )}
        {details.length > 0 && (
          <Box sx={{ fontSize: '0.75rem', mt: changes.length > 0 ? 0.5 : 0 }}>
            {details.slice(0, 3).map((d, i) => (
              <Box key={i} display="flex" gap={0.5}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, minWidth: 70 }}>
                  {d.label}:
                </Typography>
                <Typography variant="caption">{d.value}</Typography>
              </Box>
            ))}
            {details.length > 3 && (
              <Typography variant="caption" color="text.secondary">+{details.length - 3} …</Typography>
            )}
          </Box>
        )}
      </TableCell>

      {/* Status */}
      <TableCell>
        {isError && (
          <Chip label={entry.statusCode} size="small" color="error" sx={{ fontSize: '0.65rem', height: 18 }} />
        )}
      </TableCell>
    </TableRow>
  )
}
