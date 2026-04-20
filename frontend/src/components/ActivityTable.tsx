import { Fragment } from 'react'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import LoginIcon from '@mui/icons-material/Login'
import LogoutIcon from '@mui/icons-material/Logout'
import OpenInBrowserIcon from '@mui/icons-material/OpenInBrowser'
import DownloadIcon from '@mui/icons-material/Download'
import InstallDesktopIcon from '@mui/icons-material/InstallDesktop'
import BlockIcon from '@mui/icons-material/Block'
import PasswordIcon from '@mui/icons-material/Password'
import SecurityIcon from '@mui/icons-material/Security'
import SyncIcon from '@mui/icons-material/Sync'
import SendIcon from '@mui/icons-material/Send'
import InfoIcon from '@mui/icons-material/Info'
import ErrorIcon from '@mui/icons-material/Error'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ActivityLogEntry } from '../features/activity-log/queries'
import {
  formatActionTitle,
  formatChanges,
  formatDetails,
  actionColor,
  actionIconKey,
} from '../lib/activity-log-format'

const ICON_MAP: Record<string, React.ElementType> = {
  add: AddIcon,
  edit: EditIcon,
  delete: DeleteIcon,
  login: LoginIcon,
  logout: LogoutIcon,
  visu: OpenInBrowserIcon,
  deploy: InstallDesktopIcon,
  download: DownloadIcon,
  block: BlockIcon,
  password: PasswordIcon,
  security: SecurityIcon,
  system: SyncIcon,
  command: SendIcon,
  error: ErrorIcon,
  info: InfoIcon,
}

function colorToken(c: string): string {
  switch (c) {
    case 'error':    return 'error.main'
    case 'success':  return 'success.main'
    case 'primary':  return 'primary.main'
    case 'info':     return 'info.main'
    case 'warning':  return 'warning.main'
    default:         return 'text.disabled'
  }
}

interface Props {
  entries: ActivityLogEntry[]
}

export function ActivityTable({ entries }: Props) {
  const { t } = useTranslation()

  // Nach Datum gruppieren (für Section-Header)
  const groups = groupByDate(entries)

  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider' }}>
      <Table size="small" sx={{
        '& td, & th': { py: 0.75, px: 1.25, verticalAlign: 'top' },
        '& tr:hover td': { bgcolor: 'action.hover' },
      }}>
        <TableHead>
          <TableRow sx={{ '& th': { fontWeight: 600, bgcolor: 'background.default' } }}>
            <TableCell sx={{ width: 80 }}>{t('activityLog.time', 'Zeit')}</TableCell>
            <TableCell sx={{ width: 180 }}>{t('activityLog.user', 'Benutzer')}</TableCell>
            <TableCell>{t('activityLog.actionCol', 'Aktion')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((group) => (
            <Fragment key={group.dateKey}>
              <TableRow>
                <TableCell
                  colSpan={3}
                  sx={{
                    bgcolor: 'action.selected',
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    py: 0.5,
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 0.5 }}>
                    {formatDateHeader(group.date, t)}
                  </Typography>
                </TableCell>
              </TableRow>
              {group.entries.map((entry) => (
                <Row key={entry.id} entry={entry} />
              ))}
            </Fragment>
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
  const iconKey = actionIconKey(entry.action)
  const Icon = ICON_MAP[iconKey] ?? InfoIcon
  const isError = entry.statusCode && entry.statusCode >= 400
  const date = new Date(entry.createdAt)

  return (
    <TableRow>
      {/* Zeit (nur Uhrzeit, Datum via Group-Header) */}
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Tooltip title={date.toLocaleString()}>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
            {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Typography>
        </Tooltip>
      </TableCell>

      {/* Benutzer (IP im Tooltip) */}
      <TableCell sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
        <Tooltip title={entry.ipAddress ? `IP: ${entry.ipAddress}` : ''}>
          <Typography
            variant="caption"
            sx={{
              fontSize: '0.82rem',
              color: entry.userEmail ? 'text.primary' : 'text.disabled',
              fontStyle: entry.userEmail ? 'normal' : 'italic',
            }}
          >
            {entry.userEmail ?? t('activityLog.system', 'System')}
          </Typography>
        </Tooltip>
      </TableCell>

      {/* Aktion: Icon + Titel + Diff/Details inline */}
      <TableCell>
        <Box display="flex" alignItems="flex-start" gap={1}>
          <Box
            sx={{
              flexShrink: 0,
              width: 22, height: 22,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: colorToken(color),
              color: 'common.white',
              mt: 0.25,
            }}
          >
            <Icon sx={{ fontSize: 14 }} />
          </Box>
          <Box flex={1} minWidth={0}>
            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
              <Typography
                variant="body2"
                sx={{ fontWeight: 500, lineHeight: 1.3 }}
              >
                {title}
              </Typography>
              {isError && (
                <Typography
                  variant="caption"
                  sx={{
                    fontFamily: 'monospace',
                    color: 'error.main',
                    fontWeight: 700,
                    bgcolor: 'error.light',
                    px: 0.75,
                    borderRadius: 0.5,
                    fontSize: '0.7rem',
                  }}
                >
                  {entry.statusCode}
                </Typography>
              )}
            </Box>

            {/* Diffs + Details inline als fließende Liste */}
            {(changes.length > 0 || details.length > 0) && (
              <Box
                sx={{
                  mt: 0.35,
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                  display: 'flex',
                  gap: 1.5,
                  flexWrap: 'wrap',
                  rowGap: 0.2,
                }}
              >
                {changes.slice(0, 5).map((c, i) => (
                  <Box key={`c${i}`} display="inline-flex" gap={0.4} alignItems="baseline">
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{c.label}:</Typography>
                    <Typography variant="caption" sx={{ textDecoration: 'line-through', opacity: 0.6, fontFamily: 'monospace' }}>
                      {c.from}
                    </Typography>
                    <Typography variant="caption">→</Typography>
                    <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600, fontFamily: 'monospace' }}>
                      {c.to}
                    </Typography>
                  </Box>
                ))}
                {changes.length > 5 && (
                  <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
                    +{changes.length - 5} weitere
                  </Typography>
                )}

                {details.slice(0, 3).map((d, i) => (
                  <Box key={`d${i}`} display="inline-flex" gap={0.4} alignItems="baseline">
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>{d.label}:</Typography>
                    <Typography variant="caption">{d.value}</Typography>
                  </Box>
                ))}
                {details.length > 3 && (
                  <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
                    +{details.length - 3}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </Box>
      </TableCell>
    </TableRow>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface DateGroup {
  dateKey: string        // YYYY-MM-DD
  date: Date
  entries: ActivityLogEntry[]
}

function groupByDate(entries: ActivityLogEntry[]): DateGroup[] {
  const groups: DateGroup[] = []
  const map = new Map<string, DateGroup>()
  for (const entry of entries) {
    const d = new Date(entry.createdAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let grp = map.get(key)
    if (!grp) {
      grp = { dateKey: key, date: d, entries: [] }
      map.set(key, grp)
      groups.push(grp)
    }
    grp.entries.push(entry)
  }
  return groups
}

function formatDateHeader(date: Date, t: TFunction): string {
  const now = new Date()
  const isToday = date.getDate() === now.getDate()
                && date.getMonth() === now.getMonth()
                && date.getFullYear() === now.getFullYear()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.getDate() === yesterday.getDate()
                    && date.getMonth() === yesterday.getMonth()
                    && date.getFullYear() === yesterday.getFullYear()

  const pretty = date.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  if (isToday)     return `${t('activityLog.today', 'Heute')} · ${pretty}`.toUpperCase()
  if (isYesterday) return `${t('activityLog.yesterday', 'Gestern')} · ${pretty}`.toUpperCase()
  return pretty.toUpperCase()
}
