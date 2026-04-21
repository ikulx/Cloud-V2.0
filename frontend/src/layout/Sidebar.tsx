import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import DashboardIcon from '@mui/icons-material/Dashboard'
import DevicesIcon from '@mui/icons-material/DevicesOther'
import BusinessIcon from '@mui/icons-material/Business'
import GroupIcon from '@mui/icons-material/Group'
import PersonIcon from '@mui/icons-material/Person'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import SettingsIcon from '@mui/icons-material/Settings'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import HistoryIcon from '@mui/icons-material/History'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import AssignmentIcon from '@mui/icons-material/Assignment'
import { NavLink } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useTranslation } from 'react-i18next'

interface SidebarProps {
  onNavClick?: () => void
}

export function Sidebar({ onNavClick }: SidebarProps) {
  const { hasPermission, me } = useSession()
  const { t } = useTranslation()

  const isBenutzer = me?.roleName === 'benutzer'

  const NAV_ITEMS = isBenutzer
    ? [
        { label: 'User-Dashboard', icon: <DashboardIcon />, to: '/', permission: null },
        { label: t('nav.settings'), icon: <SettingsIcon />, to: '/settings', permission: null },
      ]
    : [
        { label: t('nav.dashboard'), icon: <DashboardIcon />, to: '/', permission: null },
        { label: t('nav.devices'), icon: <DevicesIcon />, to: '/devices', permission: 'devices:read' },
        { label: t('nav.anlagen'), icon: <BusinessIcon />, to: '/anlagen', permission: 'anlagen:read' },
        { label: t('nav.wiki'), icon: <MenuBookIcon />, to: '/wiki', permission: 'wiki:read' },
        { label: 'Meine Todos', icon: <AssignmentIcon />, to: '/my-todos', permission: null },
        { label: t('nav.groups'), icon: <GroupIcon />, to: '/groups', permission: 'groups:read' },
        { label: t('nav.users'), icon: <PersonIcon />, to: '/users', permission: 'users:read' },
        { label: t('nav.roles'), icon: <AdminPanelSettingsIcon />, to: '/roles', permission: 'roles:read' },
        { label: t('nav.settings'), icon: <SettingsIcon />, to: '/settings', permission: null },
        { label: t('nav.vpn'),      icon: <VpnKeyIcon />,  to: '/vpn',      permission: 'vpn:manage' },
        { label: t('nav.activityLog'), icon: <HistoryIcon />, to: '/activity-log', permission: 'activityLog:read' },
      ]

  const visible = NAV_ITEMS.filter((item) =>
    item.permission === null || hasPermission(item.permission)
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ p: 2, pt: 3 }}>
        <Typography variant="h6" sx={{ color: 'white', fontWeight: 700 }}>
          YControl Cloud
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>
          v2.0
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.12)' }} />

      <List sx={{ flexGrow: 1, pt: 1 }}>
        {visible.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavClick}
            sx={{
              color: 'rgba(255,255,255,0.7)',
              borderRadius: 1,
              mx: 1,
              mb: 0.5,
              '&.active': {
                bgcolor: 'rgba(255,255,255,0.15)',
                color: 'white',
              },
              '&:hover': {
                bgcolor: 'rgba(255,255,255,0.08)',
                color: 'white',
              },
            }}
          >
            <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 14 }} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  )
}
