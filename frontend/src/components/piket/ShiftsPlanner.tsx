import { useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Alert from '@mui/material/Alert'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Table from '@mui/material/Table'
import TableHead from '@mui/material/TableHead'
import TableBody from '@mui/material/TableBody'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import Paper from '@mui/material/Paper'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import DownloadIcon from '@mui/icons-material/FileDownload'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import * as XLSX from 'xlsx'
import {
  usePiketRegions, usePiketShifts, useBulkPiketShifts,
  type PiketRegion, type PiketShift,
} from '../../features/piket/queries'
import { useUsers } from '../../features/users/queries'
import type { UserSummary } from '../../types/model'

/** ISO-Wochennummer (Mo = erster Tag, KW1 enthält 4. Januar). */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (t.getUTCDay() + 6) % 7 // Mo=0 … So=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const diff = (t.getTime() - firstThu.getTime()) / 86400000
  return 1 + Math.round((diff - (((firstThu.getUTCDay() + 6) % 7) - 3)) / 7)
}

function daysOfYear(year: number): Date[] {
  const days: Date[] = []
  const start = new Date(year, 0, 1)
  while (start.getFullYear() === year) {
    days.push(new Date(start))
    start.setDate(start.getDate() + 1)
  }
  return days
}

function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Formatiert E.164 (+41…) zu lesbarer Schweizer Nummer "079 638 69 96".
 *  Andere Landesvorwahlen werden unverändert zurückgegeben. */
function formatPhoneForExcel(phone: string | null | undefined): string {
  if (!phone) return ''
  const p = phone.trim()
  if (/^\+41\d{9}$/.test(p)) {
    const d = p.slice(3)
    return `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`
  }
  return p
}

/** Erzeugt & lädt eine Excel-Datei mit Datum/KW + pro Bereich zwei Spalten
 *  (Name + Telefon) für das gegebene Jahr. */
function exportYearToExcel(
  year: number,
  days: Date[],
  regions: PiketRegion[],
  shiftIndex: Map<string, PiketShift>,
  userMap: Map<string, UserSummary>,
) {
  const header: string[] = ['Datum', 'KW']
  for (const r of regions) { header.push(r.name, 'Telefon') }

  const rows: (string | number)[][] = [header]
  for (const d of days) {
    const dk = dayKey(d)
    const row: (string | number)[] = [fmtDate(d), isoWeek(d)]
    for (const r of regions) {
      const s = shiftIndex.get(`${r.id}|${dk}`)
      const u = s ? userMap.get(s.userId) : null
      row.push(u ? `${u.lastName} - ${u.firstName}` : '')
      row.push(u ? formatPhoneForExcel(u.phone) : '')
    }
    rows.push(row)
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  // Spaltenbreiten: Datum=12, KW=5, Name=24, Telefon=16
  ws['!cols'] = [
    { wch: 12 }, { wch: 5 },
    ...regions.flatMap(() => [{ wch: 24 }, { wch: 16 }]),
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Piket ${year}`)
  XLSX.writeFile(wb, `piket-schicht-${year}.xlsx`)
}

export function ShiftsPlanner() {
  const { data: regions = [] } = usePiketRegions()
  const { data: users = [] } = useUsers()

  const currentYear = new Date().getFullYear()
  const years = [currentYear - 1, currentYear, currentYear + 1]

  // Alle Shifts in einem Rutsch laden (3 Jahre = max ~1100 Tage × Regionen).
  const from = `${currentYear - 1}-01-01`
  const to   = `${currentYear + 1}-12-31`
  const { data: shifts = [], isLoading } = usePiketShifts({ from, to })

  // Index für O(1)-Lookup: key = regionId|YYYY-MM-DD.
  const shiftIndex = useMemo(() => {
    const m = new Map<string, PiketShift>()
    for (const s of shifts) {
      const d = new Date(s.date)
      m.set(`${s.regionId}|${dayKey(d)}`, s)
    }
    return m
  }, [shifts])

  // Selection: Set von "regionId|YYYY-MM-DD"
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastClicked, setLastClicked] = useState<{ regionId: string; dateKey: string; yearIdx: number } | null>(null)

  const toggle = (regionId: string, dateKey: string, yearIdx: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const k = `${regionId}|${dateKey}`
      if (shiftKey && lastClicked && lastClicked.regionId === regionId && lastClicked.yearIdx === yearIdx) {
        // Bereichsselektion in derselben Spalte/Jahr
        const from = lastClicked.dateKey < dateKey ? lastClicked.dateKey : dateKey
        const to   = lastClicked.dateKey < dateKey ? dateKey : lastClicked.dateKey
        const days = daysOfYear(years[yearIdx])
        for (const d of days) {
          const dk = dayKey(d)
          if (dk >= from && dk <= to && !isPast(d)) next.add(`${regionId}|${dk}`)
        }
      } else if (next.has(k)) {
        next.delete(k)
      } else {
        next.add(k)
      }
      return next
    })
    setLastClicked({ regionId, dateKey, yearIdx })
  }

  const clearSelection = () => setSelected(new Set())

  const bulk = useBulkPiketShifts()
  const [targetUserId, setTargetUserId] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  const assign = async (action: 'assign' | 'clear') => {
    setErr(null)
    if (selected.size === 0) return
    if (action === 'assign' && !targetUserId) { setErr('Bitte zuerst Techniker wählen.'); return }
    const assignments = [...selected].map((k) => {
      const [regionId, date] = k.split('|')
      return { regionId, date }
    })
    try {
      await bulk.mutateAsync({ userId: action === 'assign' ? targetUserId : null, assignments })
      clearSelection()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fehler beim Speichern')
    }
  }

  if (regions.length === 0) {
    return <Alert severity="info">Zuerst mindestens einen Bereich anlegen, dann kann die Schichtplanung genutzt werden.</Alert>
  }

  const renderYear = (yearIdx: number) => (
    <YearTable
      key={years[yearIdx]}
      year={years[yearIdx]}
      label={yearIdx === 0 ? 'Letztes Jahr' : yearIdx === 1 ? 'Dieses Jahr' : 'Nächstes Jahr'}
      yearIdx={yearIdx}
      regions={regions}
      shiftIndex={shiftIndex}
      users={users}
      selected={selected}
      onToggle={toggle}
    />
  )

  return (
    <Box>
      {/* Letztes Jahr ZUERST (eingeklappt, selten gebraucht) – über der
          sticky Aktionsleiste, damit sie beim Scrollen nicht stört. */}
      {!isLoading && renderYear(0)}

      {/* ── Aktionsleiste ─────────────────────────────────────── */}
      <Paper sx={{ p: 2, mb: 2, position: 'sticky', top: 0, zIndex: 10 }} elevation={1}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            <strong>{selected.size}</strong> Zelle{selected.size === 1 ? '' : 'n'} ausgewählt.
            Klick zum Umschalten, Shift-Klick für Bereiche in derselben Spalte.
          </Typography>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel>Techniker zuweisen</InputLabel>
            <Select
              label="Techniker zuweisen"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value as string)}
              renderValue={(id) => {
                const u = users.find((x) => x.id === id)
                return u ? `${u.firstName} ${u.lastName}` : ''
              }}
            >
              {users.map((u: UserSummary) => {
                const ok = !!u.phone && /^\+[1-9]\d{7,14}$/.test(u.phone)
                return (
                  <MenuItem key={u.id} value={u.id} disabled={!ok}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                      <span>{u.firstName} {u.lastName}</span>
                      {ok ? (
                        <Chip size="small" variant="outlined" label={u.phone} sx={{ ml: 'auto' }} />
                      ) : (
                        <Tooltip title="Keine gültige Mobilnummer">
                          <Chip size="small" color="warning" icon={<WarningAmberIcon />} label="Keine Nr." sx={{ ml: 'auto' }} />
                        </Tooltip>
                      )}
                    </Stack>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            disabled={selected.size === 0 || !targetUserId || bulk.isPending}
            onClick={() => void assign('assign')}
          >
            Zuweisen
          </Button>
          <Button
            variant="outlined"
            color="error"
            disabled={selected.size === 0 || bulk.isPending}
            onClick={() => void assign('clear')}
          >
            Entfernen
          </Button>
          <Button disabled={selected.size === 0} onClick={clearSelection}>
            Auswahl löschen
          </Button>
        </Stack>
        {err && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setErr(null)}>{err}</Alert>}
      </Paper>

      {isLoading ? (
        <Typography variant="body2" color="text.secondary">Lädt …</Typography>
      ) : (
        <>
          {renderYear(1)}
          {renderYear(2)}
        </>
      )}
    </Box>
  )
}

function isPast(d: Date): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function YearTable({
  year, label, yearIdx, regions, shiftIndex, users, selected, onToggle,
}: {
  year: number
  label: string
  yearIdx: number
  regions: PiketRegion[]
  shiftIndex: Map<string, PiketShift>
  users: UserSummary[]
  selected: Set<string>
  onToggle: (regionId: string, dateKey: string, yearIdx: number, shiftKey: boolean) => void
}) {
  const days = useMemo(() => daysOfYear(year), [year])
  const userMap = useMemo(() => {
    const m = new Map<string, UserSummary>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])
  // Letztes Jahr standardmässig eingeklappt – wird selten gebraucht.
  const [open, setOpen] = useState(yearIdx !== 0)
  // Auto-Scroll zur heutigen Zeile, wenn das aktuelle Jahr geöffnet wird.
  // Direktes scrollTop auf den TableContainer, damit die Collapse-Animation
  // nicht im Weg ist.
  const todayKey = useMemo(() => dayKey(new Date()), [])
  const todayRowRef = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => {
    if (yearIdx !== 1 || !open) return
    const t = setTimeout(() => {
      const row = todayRowRef.current
      if (!row) return
      const container = row.closest('.MuiTableContainer-root') as HTMLDivElement | null
      if (!container) { row.scrollIntoView({ block: 'center', behavior: 'auto' }); return }
      const rowRect = row.getBoundingClientRect()
      const cRect   = container.getBoundingClientRect()
      const offset  = rowRect.top - cRect.top + container.scrollTop - container.clientHeight / 2 + row.clientHeight / 2
      container.scrollTop = Math.max(0, offset)
    }, 500)
    return () => clearTimeout(t)
  }, [yearIdx, open])

  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', mb: 3 }}>
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{
          p: 1.5, borderBottom: open ? '1px solid' : 'none', borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', userSelect: 'none',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <IconButton size="small" sx={{ p: 0.25 }}>
          {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
        </IconButton>
        <Typography variant="subtitle1" fontWeight={600}>{label} · {year}</Typography>
        <Typography variant="caption" color="text.secondary">
          {days.length} Tage × {regions.length} Bereich{regions.length === 1 ? '' : 'e'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon fontSize="small" />}
          onClick={(e) => {
            e.stopPropagation()
            exportYearToExcel(year, days, regions, shiftIndex, userMap)
          }}
        >
          Excel
        </Button>
      </Box>
      <Collapse in={open} unmountOnExit>
      <TableContainer sx={{ maxHeight: 560 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 120, position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 2 }}>Datum</TableCell>
              <TableCell sx={{ width: 50 }}>KW</TableCell>
              {regions.map((r) => (
                <TableCell key={r.id} sx={{ whiteSpace: 'nowrap' }}>{r.name}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {days.map((d) => {
              const dk = dayKey(d)
              const kw = isoWeek(d)
              const past = isPast(d)
              const weekend = d.getDay() === 0 || d.getDay() === 6
              const isToday = dk === todayKey
              return (
                <TableRow
                  key={dk}
                  ref={isToday ? todayRowRef : undefined}
                  sx={{
                    bgcolor: isToday ? 'primary.dark' : weekend ? 'action.hover' : undefined,
                    opacity: past ? 0.45 : 1,
                  }}
                >
                  <TableCell sx={{
                    position: 'sticky', left: 0, zIndex: 1,
                    bgcolor: isToday ? 'primary.dark' : weekend ? 'action.hover' : 'background.paper',
                    color: isToday ? 'primary.contrastText' : undefined,
                    fontFamily: 'monospace', fontSize: 12,
                    fontWeight: isToday ? 600 : undefined,
                  }}>
                    {fmtDate(d)}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{kw}</TableCell>
                  {regions.map((r) => {
                    const key = `${r.id}|${dk}`
                    const s = shiftIndex.get(key)
                    const u = s ? userMap.get(s.userId) : null
                    const isSelected = selected.has(key)
                    return (
                      <TableCell
                        key={r.id}
                        onClick={(e) => {
                          if (past) return
                          onToggle(r.id, dk, yearIdx, e.shiftKey)
                        }}
                        sx={{
                          cursor: past ? 'not-allowed' : 'pointer',
                          userSelect: 'none',
                          bgcolor: isSelected ? 'primary.dark' : undefined,
                          color: isSelected ? 'primary.contrastText' : undefined,
                          fontSize: 13,
                          whiteSpace: 'nowrap',
                          borderLeft: isSelected ? '2px solid' : undefined,
                          borderLeftColor: isSelected ? 'primary.main' : undefined,
                          '&:hover': past ? undefined : { bgcolor: isSelected ? 'primary.main' : 'action.selected' },
                        }}
                      >
                        {u ? `${u.lastName} - ${u.firstName}` : <span style={{ opacity: 0.4 }}>—</span>}
                      </TableCell>
                    )
                  })}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      </Collapse>
    </Paper>
  )
}
