import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
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
  actionIconKey,
  actionColor,
  type DiffRow,
  type DetailRow,
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

function colorHex(c: string): string {
  switch (c) {
    case 'error':    return 'error.main'
    case 'success':  return 'success.main'
    case 'primary':  return 'primary.main'
    case 'info':     return 'info.main'
    case 'warning':  return 'warning.main'
    default:         return 'divider'
  }
}

interface Props {
  entry: ActivityLogEntry
}

export function ActivityCard({ entry }: Props) {
  const { t } = useTranslation()
  const title = formatActionTitle(entry, t)
  const changes: DiffRow[] = formatChanges(entry, t)
  const details: DetailRow[] = formatDetails(entry, t)
  const color = actionColor(entry.action)
  const iconKey = actionIconKey(entry.action)
  const Icon = ICON_MAP[iconKey] ?? InfoIcon

  const time = new Date(entry.createdAt).toLocaleString()
  const who = entry.userEmail ?? t('activityLog.system', 'System')
  const relTime = formatRelativeTime(entry.createdAt, t)

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: '4px solid',
        borderLeftColor: colorHex(color),
        p: 2,
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
      }}
    >
      {/* Icon */}
      <Box
        sx={{
          flexShrink: 0,
          width: 36, height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: colorHex(color),
          color: 'common.white',
          opacity: 0.9,
        }}
      >
        <Icon fontSize="small" />
      </Box>

      {/* Inhalt */}
      <Box flex={1} minWidth={0}>
        {/* Titel + Meta-Zeile */}
        <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
          {title}
        </Typography>
        <Box display="flex" alignItems="center" gap={0.75} mt={0.25} flexWrap="wrap">
          <Typography variant="caption" color="text.secondary">{who}</Typography>
          <Typography variant="caption" color="text.secondary">·</Typography>
          <Tooltip title={time}>
            <Typography variant="caption" color="text.secondary">{relTime}</Typography>
          </Tooltip>
          {entry.ipAddress && (
            <>
              <Typography variant="caption" color="text.secondary">·</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {entry.ipAddress}
              </Typography>
            </>
          )}
          {entry.statusCode && entry.statusCode >= 400 && (
            <Chip label={entry.statusCode} size="small" color="error"
              sx={{ fontSize: '0.65rem', height: 18, ml: 0.5 }} />
          )}
        </Box>

        {/* Diff-Tabelle */}
        {changes.length > 0 && (
          <Box
            mt={1.25}
            display="grid"
            gridTemplateColumns="minmax(100px, max-content) 1fr auto 1fr"
            columnGap={1.5}
            rowGap={0.5}
            alignItems="baseline"
            sx={{ fontSize: '0.85rem' }}
          >
            {changes.map((c, i) => (
              <Box key={i} sx={{ display: 'contents' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                  {c.label}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    fontFamily: 'monospace',
                    color: 'text.secondary',
                    textDecoration: 'line-through',
                    opacity: 0.7,
                    wordBreak: 'break-word',
                  }}
                >
                  {c.from}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>→</Typography>
                <Typography
                  variant="caption"
                  sx={{
                    fontFamily: 'monospace',
                    color: 'success.main',
                    fontWeight: 600,
                    wordBreak: 'break-word',
                  }}
                >
                  {c.to}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {/* Zusätzliche Details (nicht-diff) */}
        {details.length > 0 && (
          <Box
            mt={changes.length > 0 ? 0.75 : 1}
            display="grid"
            gridTemplateColumns="minmax(100px, max-content) 1fr"
            columnGap={1.5}
            rowGap={0.25}
            sx={{ fontSize: '0.85rem' }}
          >
            {details.map((d, i) => (
              <Box key={i} sx={{ display: 'contents' }}>
                <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
                  {d.label}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.primary', wordBreak: 'break-word' }}>
                  {d.value}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Paper>
  )
}

/** "vor 5 Min", "vor 2 Std", "gestern", "17.04.2026" */
function formatRelativeTime(iso: string, t: TFunction): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60)    return t('activityLog.justNow', 'gerade eben')
  if (diffSec < 3600)  return t('activityLog.minutesAgo', 'vor {{n}} Min', { n: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('activityLog.hoursAgo', 'vor {{n}} Std', { n: Math.floor(diffSec / 3600) })
  if (diffSec < 172800) return t('activityLog.yesterday', 'gestern')
  return new Date(iso).toLocaleDateString()
}
