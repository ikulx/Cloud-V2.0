import { prisma } from '../db/prisma'
import { sendMail } from './mail.service'
import { getSetting } from '../routes/settings.router'

/**
 * Todo-Benachrichtigungen per E-Mail
 * ──────────────────────────────────
 * - notifyOnCreate: beim Erstellen eines Todos an alle zugewiesenen Emp-
 *   fänger (User + Gruppen). Wird aus dem POST-Todo-Handler aufgerufen.
 * - runDueReminderTick: läuft periodisch (alle 30 min) und schickt 24h
 *   vor Fälligkeit eine Erinnerung; Idempotenz via AnlageTodo.dueReminderSentAt.
 *
 * Gruppen-Empfänger-Regel: wenn group.email gesetzt ist, geht die Mail NUR
 * an diese Adresse (Verteiler). Ohne group.email werden die einzelnen
 * Member benachrichtigt (Fallback, damit nicht niemand informiert wird).
 */

const REMINDER_LOOKAHEAD_MS = 24 * 60 * 60 * 1000  // 24h voraus
const REMINDER_POLL_INTERVAL_MS = 30 * 60 * 1000    // 30 min
const REMINDER_INITIAL_DELAY_MS = 2 * 60 * 1000     // 2 min nach Start

let timer: NodeJS.Timeout | null = null

export function startTodoReminderScheduler(): void {
  if (timer) return
  setTimeout(() => { void runDueReminderTick().catch((e) => console.error('[TodoReminder] Init:', e)) }, REMINDER_INITIAL_DELAY_MS)
  timer = setInterval(() => { void runDueReminderTick().catch((e) => console.error('[TodoReminder] Tick:', e)) }, REMINDER_POLL_INTERVAL_MS)
  console.log(`[TodoReminder] Scheduler aktiv (Poll: ${REMINDER_POLL_INTERVAL_MS / 60000} min)`)
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

/** Findet Todos deren Fälligkeit in < 24h liegt und schickt 1x einen Reminder. */
async function runDueReminderTick(): Promise<void> {
  const now = Date.now()
  const windowStart = new Date(now)
  const windowEnd = new Date(now + REMINDER_LOOKAHEAD_MS)

  const due = await prisma.anlageTodo.findMany({
    where: {
      status: 'OPEN',
      notifyAssignees: true,
      dueReminderSentAt: null,
      dueDate: { gte: windowStart, lte: windowEnd },
    },
    include: {
      anlage: { select: { id: true, name: true } },
      assignedUsers: true,
      assignedGroups: true,
    },
  })
  if (due.length === 0) return
  console.log(`[TodoReminder] ${due.length} fällige Todos in 24h-Fenster`)

  for (const todo of due) {
    try {
      const recipients = await resolveRecipients(
        todo.assignedUsers.map((u) => u.userId),
        todo.assignedGroups.map((g) => g.groupId),
      )
      if (recipients.length === 0) {
        // Trotzdem als "gesendet" markieren, damit wir nicht jede halbe Stunde neu suchen.
        await prisma.anlageTodo.update({ where: { id: todo.id }, data: { dueReminderSentAt: new Date() } })
        continue
      }
      const link = await buildAnlageLink(todo.anlageId)
      const subject = `YControl – Erinnerung: Todo "${todo.title}" wird fällig`
      const due = todo.dueDate ? new Date(todo.dueDate).toLocaleString('de-CH') : '—'
      const html = `
        <p>Hallo,</p>
        <p>Dieses Todo wird in weniger als 24 Stunden fällig:</p>
        <table style="border-collapse:collapse">
          <tr><td><b>Titel:</b></td><td>${escapeHtml(todo.title)}</td></tr>
          <tr><td><b>Anlage:</b></td><td>${escapeHtml(todo.anlage.name)}</td></tr>
          <tr><td><b>Fällig:</b></td><td>${escapeHtml(due)}</td></tr>
        </table>
        ${todo.details ? `<p>${escapeHtml(todo.details).replace(/\n/g, '<br>')}</p>` : ''}
        <p><a href="${link}">In der Cloud öffnen</a></p>
      `
      await Promise.allSettled(recipients.map((to) => sendMail(to, subject, html)))
      await prisma.anlageTodo.update({ where: { id: todo.id }, data: { dueReminderSentAt: new Date() } })
      console.log(`[TodoReminder] Mail an ${recipients.length} Empfänger (todoId=${todo.id})`)
    } catch (e) {
      console.error(`[TodoReminder] Fehler für Todo ${todo.id}:`, (e as Error).message)
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] || c))
}
