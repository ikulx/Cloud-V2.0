import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAnlagen } from '../features/anlagen/queries'
import { useDevices } from '../features/devices/queries'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import type { Anlage, Device } from '../types/model'

// ─── Status-Berechnung (gleich wie AnlagenPage) ─────────────────────────────

type AnlageStatus = 'OK' | 'TODO' | 'ERROR' | 'OFFLINE' | 'EMPTY'

function computeAnlageStatus(devices: Device[]): AnlageStatus {
  if (devices.length === 0) return 'EMPTY'
  const hasOffline = devices.some((d) => d.status !== 'ONLINE')
  if (hasOffline) return 'OFFLINE'
  const hasError = devices.some((d) => d.hasError === true)
  if (hasError) return 'ERROR'
  const hasTodos = devices.some((d) => (d._count?.todos ?? 0) > 0)
  if (hasTodos) return 'TODO'
  return 'OK'
}

// ─── Pin-Farben pro Status ──────────────────────────────────────────────────

const STATUS_COLORS: Record<AnlageStatus, string> = {
  OK: '#4caf50',
  TODO: '#ff9800',
  ERROR: '#f44336',
  OFFLINE: '#d32f2f',
  EMPTY: '#9e9e9e',
}

const STATUS_LABELS: Record<AnlageStatus, string> = {
  OK: 'OK',
  TODO: 'Todos offen',
  ERROR: 'Fehler',
  OFFLINE: 'Offline',
  EMPTY: 'Keine Geräte',
}

function createPinIcon(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="28" height="42">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    tooltipAnchor: [0, -42],
  })
}

// ─── Auto-Fit Bounds ────────────────────────────────────────────────────────

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  useMemo(() => {
    if (positions.length === 0) return
    if (positions.length === 1) {
      map.setView(positions[0], 13)
    } else {
      const bounds = L.latLngBounds(positions.map(([lat, lng]) => [lat, lng]))
      map.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [positions, map])
  return null
}

// ─── Hauptkomponente ────────────────────────────────────────────────────────

export function AnlagenMapPage() {
  const navigate = useNavigate()
  const { data: anlagen, isLoading } = useAnlagen()
  const { data: allDevices } = useDevices()
  useDeviceStatus()

  // Nur Anlagen mit Koordinaten anzeigen
  const mappableAnlagen = useMemo(() => {
    if (!anlagen) return []
    return anlagen
      .filter((a) => a.latitude != null && a.longitude != null)
      .map((a) => {
        const deviceIds = new Set(a.anlageDevices.map((ad) => ad.device.id))
        const devices = (allDevices ?? []).filter((d) => deviceIds.has(d.id))
        const status = computeAnlageStatus(devices)
        return { anlage: a, status, devices }
      })
  }, [anlagen, allDevices])

  const positions: [number, number][] = mappableAnlagen.map(({ anlage: a }) => [a.latitude!, a.longitude!])

  // Default-Zentrum: Schweiz
  const defaultCenter: [number, number] = [46.8, 8.2]
  const defaultZoom = 8

  if (isLoading) {
    return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <IconButton onClick={() => navigate('/anlagen')}><ArrowBackIcon /></IconButton>
        <Typography variant="h5">Anlagen-Karte</Typography>
        <Typography variant="body2" color="text.secondary">
          {mappableAnlagen.length} von {anlagen?.length ?? 0} Anlagen mit Koordinaten
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 400, borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <MapContainer
          center={defaultCenter}
          zoom={defaultZoom}
          style={{ width: '100%', height: '100%', minHeight: 500 }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={positions} />

          {mappableAnlagen.map(({ anlage: a, status, devices }) => (
            <Marker
              key={a.id}
              position={[a.latitude!, a.longitude!]}
              icon={createPinIcon(STATUS_COLORS[status])}
              eventHandlers={{
                click: () => navigate(`/anlagen/${a.id}`),
              }}
            >
              <Tooltip direction="top" opacity={0.95}>
                <Box sx={{ minWidth: 180 }}>
                  <Typography variant="subtitle2" fontWeight={700}>{a.name}</Typography>
                  {a.projectNumber && (
                    <Typography variant="caption" color="text.secondary">Projekt {a.projectNumber}</Typography>
                  )}
                  {a.city && (
                    <Typography variant="body2">{[a.zip, a.city].filter(Boolean).join(' ')}</Typography>
                  )}
                  <Box display="flex" alignItems="center" gap={0.5} mt={0.5}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: STATUS_COLORS[status] }} />
                    <Typography variant="caption">{STATUS_LABELS[status]}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      {devices.length} Gerät{devices.length !== 1 ? 'e' : ''}
                    </Typography>
                  </Box>
                </Box>
              </Tooltip>
            </Marker>
          ))}
        </MapContainer>
      </Box>
    </Box>
  )
}
