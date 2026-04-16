import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()

  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'done'>('loading')
  const [email, setEmail] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', passwordRepeat: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`/api/invitations/verify/${token}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json()
          setEmail(data.email)
          setStatus('ready')
        } else {
          const err = await res.json().catch(() => ({ message: 'Einladung ungültig' }))
          setErrorMsg(err.message)
          setStatus('error')
        }
      })
      .catch(() => {
        setErrorMsg('Verbindung fehlgeschlagen')
        setStatus('error')
      })
  }, [token])

  const handleSubmit = async () => {
    if (form.password.length < 8) {
      setErrorMsg('Passwort muss mindestens 8 Zeichen lang sein.')
      return
    }
    if (form.password !== form.passwordRepeat) {
      setErrorMsg('Passwörter stimmen nicht überein.')
      return
    }
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setErrorMsg('Bitte Vor- und Nachname ausfüllen.')
      return
    }

    setErrorMsg('')
    setSaving(true)

    try {
      const res = await fetch(`/api/invitations/accept/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          password: form.password,
        }),
      })

      if (res.ok) {
        setStatus('done')
      } else {
        const err = await res.json().catch(() => ({ message: 'Registrierung fehlgeschlagen' }))
        setErrorMsg(err.message)
      }
    } catch {
      setErrorMsg('Verbindung fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 460 }}>
        <Box sx={{ bgcolor: 'primary.main', p: 3, textAlign: 'center' }}>
          <Typography variant="h5" sx={{ color: 'white', fontWeight: 700 }}>
            YControl Cloud
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)', mt: 0.5 }}>
            Konto erstellen
          </Typography>
        </Box>

        <CardContent sx={{ p: 3 }}>
          {status === 'loading' && (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress />
            </Box>
          )}

          {status === 'error' && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {errorMsg || 'Diese Einladung ist ungültig oder abgelaufen.'}
            </Alert>
          )}

          {status === 'done' && (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                Ihr Konto wurde erfolgreich erstellt!
              </Alert>
              <Button variant="contained" fullWidth onClick={() => navigate('/login')}>
                Zum Login
              </Button>
            </>
          )}

          {status === 'ready' && (
            <Box display="flex" flexDirection="column" gap={2}>
              <Typography variant="body2" color="text.secondary">
                Willkommen! Erstellen Sie Ihr Konto für <strong>{email}</strong>.
              </Typography>

              {errorMsg && <Alert severity="error">{errorMsg}</Alert>}

              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Vorname"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  fullWidth
                  required
                />
                <TextField
                  label="Nachname"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  fullWidth
                  required
                />
              </Box>

              <TextField
                label="Passwort"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                fullWidth
                required
                helperText="Mindestens 8 Zeichen"
              />

              <TextField
                label="Passwort wiederholen"
                type="password"
                autoComplete="new-password"
                value={form.passwordRepeat}
                onChange={(e) => setForm({ ...form, passwordRepeat: e.target.value })}
                fullWidth
                required
              />

              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={handleSubmit}
                disabled={saving}
              >
                {saving ? <CircularProgress size={24} color="inherit" /> : 'Konto erstellen'}
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
