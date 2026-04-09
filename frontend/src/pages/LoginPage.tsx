import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import { useSession } from '../context/SessionContext'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n/index'

const LANGUAGES = [
  { code: 'de', label: 'DE', flag: '🇩🇪' },
  { code: 'en', label: 'EN', flag: '🇬🇧' },
  { code: 'it', label: 'IT', flag: '🇮🇹' },
  { code: 'fr', label: 'FR', flag: '🇫🇷' },
]

export function LoginPage() {
  const { login } = useSession()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleLangChange = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem('lang', code)
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Card sx={{ width: 380, p: 2 }}>
        <CardContent>
          <Box display="flex" justifyContent="flex-end" mb={1}>
            <Select
              value={i18n.language}
              onChange={(e) => handleLangChange(e.target.value)}
              size="small"
              variant="outlined"
              sx={{ fontSize: 13 }}
            >
              {LANGUAGES.map((l) => (
                <MenuItem key={l.code} value={l.code} sx={{ gap: 1 }}>
                  {l.flag} {l.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Typography variant="h5" gutterBottom fontWeight={700} textAlign="center">
            YControl Cloud
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
            {t('login.subtitle')}
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t('common.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              fullWidth
            />
            <TextField
              label={t('login.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : null}
            >
              {loading ? t('login.loading') : t('login.submit')}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
