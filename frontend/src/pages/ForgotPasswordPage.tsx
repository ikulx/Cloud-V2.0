import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        let msg = 'Anfrage fehlgeschlagen'
        try { const err = await res.json(); msg = err.message ?? msg } catch { /* noop */ }
        throw new Error(msg)
      }
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anfrage fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
      <Card sx={{ width: { xs: '90vw', sm: 420 }, maxWidth: 420, p: 2 }}>
        <CardContent>
          <Typography variant="h5" gutterBottom fontWeight={700} textAlign="center">
            Passwort vergessen
          </Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
            Wir schicken Ihnen einen Link zum Zurücksetzen.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          {sent ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                Falls ein Konto mit dieser E-Mail existiert, haben wir einen
                Link zum Zurücksetzen geschickt. Bitte prüfen Sie Ihr Postfach.
                Der Link ist 1 Stunde gültig.
              </Alert>
              <Button component={RouterLink} to="/login" variant="contained" fullWidth>
                Zurück zur Anmeldung
              </Button>
            </>
          ) : (
            <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={2}>
              <TextField
                label="E-Mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
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
                {loading ? 'Wird gesendet …' : 'Link anfordern'}
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
