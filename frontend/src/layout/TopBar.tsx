import { useState } from 'react'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Tooltip from '@mui/material/Tooltip'
import MenuIcon from '@mui/icons-material/Menu'
import { useSession } from '../context/SessionContext'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n/index'

const LANGUAGES = [
  { code: 'de', label: 'Deutsch', flag: '\u{1F1E9}\u{1F1EA}' },
  { code: 'en', label: 'English', flag: '\u{1F1EC}\u{1F1E7}' },
  { code: 'it', label: 'Italiano', flag: '\u{1F1EE}\u{1F1F9}' },
  { code: 'fr', label: 'Fran\u00e7ais', flag: '\u{1F1EB}\u{1F1F7}' },
]

interface TopBarProps {
  onMenuClick?: () => void
  showMenuButton?: boolean
}

export function TopBar({ onMenuClick, showMenuButton }: TopBarProps) {
  const { me, logout } = useSession()
  const location = useLocation()
  const { t } = useTranslation()

  const [userAnchor, setUserAnchor] = useState<null | HTMLElement>(null)
  const [langAnchor, setLangAnchor] = useState<null | HTMLElement>(null)

  const PAGE_TITLES: Record<string, string> = {
    '/': t('nav.dashboard'),
    '/devices': t('nav.devices'),
    '/anlagen': t('nav.anlagen'),
    '/groups': t('nav.groups'),
    '/users': t('nav.users'),
    '/roles': t('nav.roles'),
  }

  const title = PAGE_TITLES[location.pathname] ?? PAGE_TITLES[`/${location.pathname.split('/')[1]}`] ?? ''
  const initials = me ? `${me.firstName[0]}${me.lastName[0]}`.toUpperCase() : '?'
  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0]

  const handleLangChange = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('lang', code)
    setLangAnchor(null)
  }

  return (
    <AppBar position="static" color="inherit" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Toolbar sx={{ px: { xs: 1, sm: 2 }, minHeight: { xs: 48, sm: 56, md: 64 } }}>
        {/* Hamburger-Button auf Mobile */}
        {showMenuButton && (
          <IconButton edge="start" onClick={onMenuClick} sx={{ mr: 1 }}>
            <MenuIcon />
          </IconButton>
        )}

        <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600, fontSize: { xs: '1rem', sm: '1.15rem', md: '1.25rem' } }} noWrap>
          {title}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
          {/* Language switcher */}
          <Tooltip title={t('topbar.language')}>
            <IconButton onClick={(e) => setLangAnchor(e.currentTarget)} size="small" sx={{ fontSize: 20 }}>
              {currentLang.flag}
            </IconButton>
          </Tooltip>

          {/* User name — nur auf grösseren Bildschirmen */}
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: 160 }}
          >
            {me?.firstName} {me?.lastName}
          </Typography>

          {/* User avatar + menu */}
          <IconButton onClick={(e) => setUserAnchor(e.currentTarget)} size="small">
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 13 }}>
              {initials}
            </Avatar>
          </IconButton>
        </Box>

        {/* Language menu */}
        <Menu anchorEl={langAnchor} open={Boolean(langAnchor)} onClose={() => setLangAnchor(null)}>
          {LANGUAGES.map((lang) => (
            <MenuItem
              key={lang.code}
              onClick={() => handleLangChange(lang.code)}
              selected={lang.code === i18n.language}
              sx={{ gap: 1 }}
            >
              <span>{lang.flag}</span> {lang.label}
            </MenuItem>
          ))}
        </Menu>

        {/* User menu */}
        <Menu anchorEl={userAnchor} open={Boolean(userAnchor)} onClose={() => setUserAnchor(null)}>
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">{me?.email}</Typography>
          </MenuItem>
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">{t('topbar.roleLabel')}: {me?.roleName ?? '\u2014'}</Typography>
          </MenuItem>
          <Divider />
          <MenuItem onClick={logout}>{t('common.logout')}</MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  )
}
