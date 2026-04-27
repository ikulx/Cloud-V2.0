import { prisma } from '../db/prisma'
import { sendMail } from './mail.service'
import { getSetting } from '../routes/settings.router'

/**
 * Todo-Benachrichtigungen per E-Mail
 * ──────────────────────────────────
 * - notifyOnCreate: beim Erstellen eines Todos an alle zugewiesenen Emp-
 *   fänger (User + Gruppen). Wird aus dem POST-Todo-Handler aufgerufen.
 * - runDigestTick: läuft alle 30 min und sendet einmal pro Tag (zur
 *   konfigurierten Stunde 'todos.digestHour', default 08:00) einen
 *   Tagesdigest pro Empfänger mit ALLEN Todos die in den nächsten 24h
 *   fällig werden. Idempotenz über (a) AnlageTodo.dueReminderSentAt
 *   (Todo war schon Teil eines Digests) + (b) System-Setting
 *   'todos.lastDigestRunAt' (innerhalb von 23h kein 2. Digest).
 *
 * Gruppen-Empfänger-Regel: wenn group.email gesetzt ist, geht die Mail NUR
 * an diese Adresse (Verteiler). Ohne group.email werden die einzelnen
 * Member benachrichtigt (Fallback, damit nicht niemand informiert wird).
 */

const REMINDER_LOOKAHEAD_MS = 24 * 60 * 60 * 1000  // 24h voraus
const REMINDER_POLL_INTERVAL_MS = 30 * 60 * 1000    // 30 min
const REMINDER_INITIAL_DELAY_MS = 2 * 60 * 1000     // 2 min nach Start
const MIN_DIGEST_INTERVAL_MS = 23 * 60 * 60 * 1000  // pro Tag max 1 Digest

let timer: NodeJS.Timeout | null = null

export function startTodoReminderScheduler(): void {
  if (timer) return
  setTimeout(() => { void runDigestTick().catch((e) => console.error('[TodoDigest] Init:', e)) }, REMINDER_INITIAL_DELAY_MS)
  timer = setInterval(() => { void runDigestTick().catch((e) => console.error('[TodoDigest] Tick:', e)) }, REMINDER_POLL_INTERVAL_MS)
  console.log(`[TodoDigest] Scheduler aktiv (Poll: ${REMINDER_POLL_INTERVAL_MS / 60000} min)`)
}
export function stopTodoReminderScheduler(): void {
  if (timer) { clearInterval(timer); timer = null }
}

/** Liste von Empfänger-Adressen aus Users + Gruppen zusammenstellen. */
async function resolveRecipients(
  userIds: string[],
  groupIds: string[],
): Promise<string[]> {
  const set = new Set<string>()
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { email: true },
    })
    for (const u of users) if (u.email) set.add(u.email)
  }
  if (groupIds.length > 0) {
    const groups = await prisma.userGroup.findMany({
      where: { id: { in: groupIds } },
      include: { members: { include: { user: { select: { email: true } } } } },
    })
    for (const g of groups) {
      if (g.email && g.email.trim()) {
        // Gruppen-Email gesetzt → NUR an diese Adresse, nicht an einzelne Member.
        set.add(g.email.trim())
      } else {
        // Fallback: an alle Member einzeln.
        for (const m of g.members) if (m.user.email) set.add(m.user.email)
      }
    }
  }
  return Array.from(set)
}

/** Baut den Anlage-Link fürs Mail-Template. */
async function buildAnlageLink(anlageId: string): Promise<string> {
  const appUrl = (await getSetting('app.url')).replace(/\/$/, '')
  return `${appUrl}/anlagen/${anlageId}`
}

/**
 * Beim Erstellen eines Todos an alle zugewiesenen Empfänger senden.
 * Wirft NIE – Fehler beim Mailen dürfen den Create-Request nicht abbrechen.
 */
export async function notifyOnCreate(todoId: string): Promise<void> {
  try {
    const todo = await prisma.anlageTodo.findUnique({
      where: { id: todoId },
      include: {
        anlage: { select: { id: true, name: true } },
        assignedUsers: true,
        assignedGroups: true,
        createdBy: { select: { firstName: true, lastName: true } },
      },
    })
    if (!todo || !todo.notifyAssignees) return

    const recipients = await resolveRecipients(
      todo.assignedUsers.map((u) => u.userId),
      todo.assignedGroups.map((g) => g.groupId),
    )
    if (recipients.length === 0) return

    const link = await buildAnlageLink(todo.anlageId)
    const subject = `YControl – Neues Todo: ${todo.title}`
    const due = todo.dueDate ? new Date(todo.dueDate).toLocaleString('de-CH') : '—'
    const author = [todo.createdBy.firstName, todo.createdBy.lastName].filter(Boolean).join(' ') || 'System'
    const html = `
      <p>Hallo,</p>
      <p>Dir wurde ein neues Todo zugewiesen:</p>
      <table style="border-collapse:collapse">
        <tr><td><b>Titel:</b></td><td>${escapeHtml(todo.title)}</td></tr>
        <tr><td><b>Anlage:</b></td><td>${escapeHtml(todo.anlage.name)}</td></tr>
        <tr><td><b>Fällig:</b></td><td>${escapeHtml(due)}</td></tr>
        <tr><td><b>Erstellt von:</b></td><td>${escapeHtml(author)}</td></tr>
      </table>
      ${todo.details ? `<p>${escapeHtml(todo.details).replace(/\n/g, '<br>')}</p>` : ''}
      <p><a href="${link}">In der Cloud öffnen</a></p>
    `
    // Ein Mailsend pro Empfänger (einfacher als CC/BCC, saubere Audit-Logs).
    await Promise.allSettled(recipients.map((to) => sendMail(to, subject, html)))
    console.log(`[TodoNotify] Create-Mail an ${recipients.length} Empfänger (todoId=${todo.id})`)
  } catch (e) {
    console.error('[TodoNotify] notifyOnCreate:', (e as Error).message)
  }
}

/**
 * Sammelt alle Todos die in den nächsten 24h fällig werden, gruppiert sie pro
 * Empfänger und schickt ein einziges Digest-Mail. Läuft maximal einmal pro Tag
 * zur konfigurierten Stunde (todos.digestHour, default 08:00).
 */
async function runDigestTick(): Promise<void> {
  const digestHour = clampHour(parseInt(await getSetting('todos.digestHour'), 10), 8)
  const now = new Date()
  if (now.getHours() < digestHour) return  // noch nicht so weit heute

  const lastRunRaw = await getSetting('todos.lastDigestRunAt')
  const lastRun = lastRunRaw ? new Date(lastRunRaw) : null
  if (lastRun && !isNaN(lastRun.getTime()) && Date.now() - lastRun.getTime() < MIN_DIGEST_INTERVAL_MS) {
    return  // schon innerhalb der letzten 23h gelaufen
  }

  const windowEnd = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS)
  const due = await prisma.anlageTodo.findMany({
    where: {
      status: 'OPEN',
      notifyAssignees: true,
      dueReminderSentAt: null,
      dueDate: { gte: now, lte: windowEnd },
    },
    include: {
      anlage: { select: { id: true, name: true } },
      assignedUsers: true,
      assignedGroups: true,
    },
    orderBy: { dueDate: 'asc' },
  })

  // Selbst wenn keine Todos da sind: lastDigestRunAt setzen, damit der Scheduler
  // nicht alle 30 min nochmal die Empfänger-Auflösung anschmeisst.
  await markDigestRun(now)
  if (due.length === 0) {
    console.log('[TodoDigest] Keine fälligen Todos für heute')
    return
  }
  console.log(`[TodoDigest] ${due.length} fällige Todos werden gebündelt versendet`)

  // Pro Empfänger eine Liste der relevanten Todos aufbauen.
  type DueTodo = (typeof due)[number]
  const perRecipient = new Map<string, DueTodo[]>()
  for (const todo of due) {
    const recipients = await resolveRecipients(
      todo.assignedUsers.map((u) => u.userId),
      todo.assignedGroups.map((g) => g.groupId),
    )
    for (const to of recipients) {
      const list = perRecipient.get(to) ?? []
      list.push(todo)
      perRecipient.set(to, list)
    }
  }

  const appUrl = (await getSetting('app.url')).replace(/\/$/, '')
  for (const [recipient, todos] of perRecipient) {
    try {
      const subject = `YControl – Tagesdigest: ${todos.length} Todo${todos.length === 1 ? '' : 's'} wird fällig`
      const html = renderDigestHtml(todos, appUrl)
      await sendMail(recipient, subject, html)
      console.log(`[TodoDigest] Digest an ${recipient} (${todos.length} Todos)`)
    } catch (e) {
      console.error(`[TodoDigest] Versand an ${recipient} fehlgeschlagen:`, (e as Error).message)
    }
  }

  // Alle einbezogenen Todos als "Reminder gesendet" markieren – einmaliger
  // Update statt einer DB-Roundtrip pro Todo.
  await prisma.anlageTodo.updateMany({
    where: { id: { in: due.map((t) => t.id) } },
    data: { dueReminderSentAt: new Date() },
  })
}

function renderDigestHtml(
  todos: Array<{
    title: string
    details: string | null
    dueDate: Date | null
    anlage: { id: string; name: string }
  }>,
  appUrl: string,
): string {
  const rows = todos.map((t) => {
    const due = t.dueDate ? new Date(t.dueDate).toLocaleString('de-CH') : '—'
    const link = `${appUrl}/anlagen/${t.anlage.id}`
    return `
      <tr style="border-top:1px solid #ddd">
        <td style="padding:6px 10px"><b>${escapeHtml(t.title)}</b><br>
          <span style="color:#666;font-size:90%">${escapeHtml(t.anlage.name)}</span>
          ${t.details ? `<br><span style="color:#444">${escapeHtml(t.details).replace(/\n/g, '<br>').slice(0, 240)}</span>` : ''}
        </td>
        <td style="padding:6px 10px;white-space:nowrap">${escapeHtml(due)}</td>
        <td style="padding:6px 10px"><a href="${link}">öffnen</a></td>
      </tr>`
  }).join('')
  return `
    <p>Folgende Todos werden in den nächsten 24 Stunden fällig:</p>
    <table style="border-collapse:collapse;border:1px solid #ddd">
      <thead style="background:#f5f5f5">
        <tr>
          <th style="text-align:left;padding:6px 10px">Titel</th>
          <th style="text-align:left;padding:6px 10px">Fällig</th>
          <th style="padding:6px 10px"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#888;font-size:90%;margin-top:18px">
      Dies ist der automatische Tagesdigest. Du erhältst diese Mail einmal pro
      Tag zur konfigurierten Digest-Zeit.
    </p>`
}

function clampHour(h: number, fallback: number): number {
  if (!Number.isFinite(h) || h < 0 || h > 23) return fallback
  return Math.floor(h)
}

async function markDigestRun(at: Date): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: 'todos.lastDigestRunAt' },
    update: { value: at.toISOString() },
    create: { key: 'todos.lastDigestRunAt', value: at.toISOString() },
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] || c))
}
