import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'
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
 *  (Name + Telefon) für das gegebene Jahr. Formatiert:
 *    - Header rot mit weisser Fettschrift
 *    - Datum/KW hellorange hinterlegt
 *    - Alle Zellen mit dünnen Rahmen
 *    - Zeilen-Filter aktiv, oberste Zeile eingefroren
 */
async function exportYearToExcel(
  year: number,
  days: Date[],
  regions: PiketRegion[],
  shiftIndex: Map<string, PiketShift>,
  userMap: Map<string, UserSummary>,
) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'YControl Cloud'
  wb.created = new Date()
  const ws = wb.addWorksheet(`Piket ${year}`, {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }],
  })

  // ── Header ────────────────────────────────────────────────────────────
  const headerRow: string[] = ['Datum', 'KW']
  for (const r of regions) { headerRow.push(r.name, 'Telefon') }
  const hr = ws.addRow(headerRow)
  hr.height = 22
  hr.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      top:    { style: 'thin', color: { argb: 'FF808080' } },
      bottom: { style: 'thin', color: { argb: 'FF808080' } },
      left:   { style: 'thin', color: { argb: 'FF808080' } },
      right:  { style: 'thin', color: { argb: 'FF808080' } },
    }
  })

  // ── Datenzeilen ───────────────────────────────────────────────────────
  const peachFill: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } }
  const border: Partial<ExcelJS.Borders> = {
    top:      { style: 'thin', color: { argb: 'FFBFBFBF' } },
    bottom:   { style: 'thin', color: { argb: 'FFBFBFBF' } },
    left:     { style: 'thin', color: { argb: 'FFBFBFBF' } },
    right:    { style: 'thin', color: { argb: 'FFBFBFBF' } },
  }

  for (const d of days) {
    const dk = dayKey(d)
    const rowValues: (string | number)[] = [fmtDate(d), isoWeek(d)]
    for (const r of regions) {
      const s = shiftIndex.get(`${r.id}|${dk}`)
      const u = s ? userMap.get(s.userId) : null
      rowValues.push(u ? `${u.lastName} - ${u.firstName}` : '')
      rowValues.push(u ? formatPhoneForExcel(u.phone) : '')
    }
    const row = ws.addRow(rowValues)
    row.eachCell((cell, colNumber) => {
      cell.border = border
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
      if (colNumber <= 2) {
        cell.fill = peachFill
        cell.font = { bold: colNumber === 1 }
      } else {
        // Name-Spalten (ungerade ab 3) vs. Telefon-Spalten (gerade ab 4)
        const isName = (colNumber - 3) % 2 === 0
        cell.font = { bold: isName }
      }
    })
  }

  // ── Spaltenbreiten ────────────────────────────────────────────────────
  ws.columns = [
    { width: 12 }, { width: 5 },
    ...regions.flatMap(() => [{ width: 24 }, { width: 16 }]),
  ]

  // ── Autofilter auf Header ─────────────────────────────────────────────
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: 2 + regions.length * 2 },
  }

  const buf = await wb.xlsx.writeBuffer()
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `piket-schicht-${year}.xlsx`)
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
  // lastClicked als Ref – ändert sich nicht, deshalb braucht es kein Re-Render.
  const lastClickedRef = useRef<{ regionId: string; dateKey: string; yearIdx: number } | null>(null)

  // Stabiler Callback (gleiche Referenz über Re-Renders), damit memoisierte
  // Cell-Komponenten beim Klick nicht alle neu zeichnen.
  const toggle = useCallback((regionId: string, dateKey: string, yearIdx: number, shiftKey: boolean) => {
    const lc = lastClickedRef.current
    setSelected((prev) => {
      const next = new Set(prev)
      const k = `${regionId}|${dateKey}`
      if (shiftKey && lc && lc.regionId === regionId && lc.yearIdx === yearIdx) {
        const fromK = lc.dateKey < dateKey ? lc.dateKey : dateKey
        const toK   = lc.dateKey < dateKey ? dateKey : lc.dateKey
        const ds = daysOfYear(years[yearIdx])
        for (const d of ds) {
          const dk = dayKey(d)
          if (dk >= fromK && dk <= toK && !isPast(d)) next.add(`${regionId}|${dk}`)
        }
      } else if (next.has(k)) {
        next.delete(k)
      } else {
        next.add(k)
      }
      return next
    })
    lastClickedRef.current = { regionId, dateKey, yearIdx }
  }, [years])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

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
            void exportYearToExcel(year, days, regions, shiftIndex, userMap)
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
                    color: isToday ? '#fff' : undefined,
                    fontFamily: 'monospace', fontSize: 12,
                    fontWeight: isToday ? 600 : undefined,
                  }}>
                    {fmtDate(d)}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: isToday ? '#fff' : 'text.secondary' }}>{kw}</TableCell>
                  {regions.map((r) => {
                    const key = `${r.id}|${dk}`
                    const s = shiftIndex.get(key)
                    const u = s ? userMap.get(s.userId) : null
                    const label = u ? `${u.lastName} - ${u.firstName}` : ''
                    return (
                      <Cell
                        key={r.id}
                        regionId={r.id}
                        dateKey={dk}
                        yearIdx={yearIdx}
                        isSelected={selected.has(key)}
                        isPast={past}
                        label={label}
                        onClick={onToggle}
                      />
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

// Memoisierte Zelle: rendert nur neu, wenn isSelected, label, isPast oder
// onClick sich tatsächlich ändern. Dadurch wird beim Klick auf eine Zelle
// nur diese eine + die vorher selektierte Zelle neu gerendert (statt aller
// 6'000 Zellen pro Jahres-Tabelle).
interface CellProps {
  regionId: string
  dateKey: string
  yearIdx: number
  isSelected: boolean
  isPast: boolean
  label: string
  onClick: (regionId: string, dateKey: string, yearIdx: number, shiftKey: boolean) => void
}
const Cell = memo(function Cell({ regionId, dateKey, yearIdx, isSelected, isPast, label, onClick }: CellProps) {
  return (
    <TableCell
      onClick={(e) => {
        if (isPast) return
        onClick(regionId, dateKey, yearIdx, e.shiftKey)
      }}
      sx={{
        cursor: isPast ? 'not-allowed' : 'pointer',
        userSelect: 'none',
        bgcolor: isSelected ? 'primary.dark' : undefined,
        color: isSelected ? '#fff' : undefined,
        fontSize: 13,
        whiteSpace: 'nowrap',
        borderLeft: isSelected ? '2px solid' : undefined,
        borderLeftColor: isSelected ? 'primary.main' : undefined,
        '&:hover': isPast ? undefined : { bgcolor: isSelected ? 'primary.main' : 'action.selected' },
      }}
    >
      {label || <span style={{ opacity: 0.4 }}>—</span>}
    </TableCell>
  )
})
