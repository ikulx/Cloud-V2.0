import { prisma } from '../db/prisma'

/**
 * Piket-Shifts-Cleanup
 * ────────────────────
 * Hält die Schicht-Tabelle auf den Jahren (currentYear-1) … (currentYear+1).
 * Alles vor dem 01.01. des Vorjahres wird beim Start und einmal täglich
 * gelöscht – dadurch verschwindet die "Letztes Jahr"-Tabelle beim
 * Jahreswechsel automatisch.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any

async function cleanupOldShifts(): Promise<number> {
  const now = new Date()
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)) // 01.01. Vorjahr
  const result = await p.piketShift.deleteMany({ where: { date: { lt: cutoff } } })
  if (result.count > 0) {
    console.log(`[PiketShiftsCleanup] ${result.count} alte Schicht(en) vor ${cutoff.toISOString().slice(0, 10)} gelöscht`)
  }
  return result.count
}

let timer: NodeJS.Timeout | null = null
const INTERVAL_MS = 24 * 60 * 60 * 1000 // täglich

export function startPiketShiftsCleanup(): void {
  if (timer) return
  // Einmaliger Lauf beim Start (verzögert, damit DB-Connect steht).
  setTimeout(() => { void cleanupOldShifts().catch((err) => console.error('[PiketShiftsCleanup]', err)) }, 10_000)
  timer = setInterval(() => { void cleanupOldShifts().catch((err) => console.error('[PiketShiftsCleanup]', err)) }, INTERVAL_MS)
  console.log('[PiketShiftsCleanup] aktiv (täglich)')
}

export function stopPiketShiftsCleanup(): void {
  if (timer) { clearInterval(timer); timer = null }
}
