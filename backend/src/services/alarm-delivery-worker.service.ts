import { processDueDeliveries } from './alarm-dispatcher.service'
import { processDuePiketActions } from './piket-manager.service'

/**
 * Delivery-Worker
 * ───────────────
 * Prüft regelmäßig, ob verzögerte Alarm-Deliveries fällig sind
 * (status=PENDING, scheduledAt <= now) und prozessiert sie über den
 * Dispatcher. Läuft alle 30 s.
 *
 * Läuft bewusst *nicht* per setTimeout pro Delivery, weil:
 *  - Delays können Minuten/Stunden dauern → Prozess-Restart würde alle
 *    geplanten Timer verlieren. DB-basierte Queue ist robust.
 *  - Auch Deliveries aus vorherigen Prozessläufen werden nachgeholt.
 */

let timer: NodeJS.Timeout | null = null
const INTERVAL_MS = 30_000

export function startAlarmDeliveryWorker(): void {
  if (timer) return
  // Kleiner Start-Delay, damit andere Initialisierungen (Prisma-Connect,
  // MQTT) nicht mit dem ersten Poll konkurrieren.
  setTimeout(tick, 5_000)
  timer = setInterval(tick, INTERVAL_MS)
  console.log(`[AlarmDeliveryWorker] aktiv (Poll-Intervall: ${INTERVAL_MS / 1000} s)`)
}

export function stopAlarmDeliveryWorker(): void {
  if (timer) { clearInterval(timer); timer = null }
}

function tick(): void {
  processDueDeliveries()
    .catch((err) => console.error('[AlarmDeliveryWorker] Tick-Fehler:', err))
  processDuePiketActions()
    .catch((err) => console.error('[PiketWorker] Tick-Fehler:', err))
}
