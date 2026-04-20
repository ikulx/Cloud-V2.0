import { useState } from 'react'
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [passwordRepeat, setPasswordRepeat] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (password !== passwordRepeat) {
      setError('Die Passwörter stimmen nicht überein.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        let msg = 'Link ist ungültig oder abgelaufen'
        try { const err = await res.json(); msg = err.message ?? msg } catch { /* noop */ }
        throw new Error(msg)
      }
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Zurücksetzen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
      <Card sx={{ width: { xs: '90vw', sm: 420 }, maxWidth: 420, p: 2 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom fontWeight={700} textAlign="center">
            Neues Passwort setzen
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          {done ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                Passwort wurde erfolgreich zurückgesetzt. Sie werden zur
                Anmeldung weitergeleitet …
              </Alert>
              <Button component={RouterLink} to="/login" variant="contained" fullWidth>
                Zur Anmeldung
              </Button>
            </>
          ) : (
            <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
              <TextField
                label="Neues Passwort"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                fullWidth
                helperText="Mindestens 8 Zeichen"
              />
              <TextField
                label="Passwort wiederholen"
                type="password"
                value={passwordRepeat}
                onChange={(e) => setPasswordRepeat(e.target.value)}
                required
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={loading || !token}
                startIcon={loading ? <CircularProgress size={16} /> : null}
              >
                {loading ? 'Wird gespeichert …' : 'Passwort setzen'}
              </Button>
              <Box textAlign="center">
                <Link component={RouterLink} to="/login" variant="body2">
                  Zurück zur Anmeldung
                </Link>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
