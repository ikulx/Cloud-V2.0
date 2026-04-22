import { prisma } from '../db/prisma'

/**
 * System-Templates (Piketdienst, Ygnis PM) sind IMMER in jeder Anlage als
 * AlarmRecipient angelegt und können nur aktiv/inaktiv geschaltet werden.
 * Alle Einstellungen (Adresse, Zeitplan, Prio, Delay) kommen global aus dem
 * Template. Hier die Helfer, um das sicherzustellen.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any

/**
 * Vertrags-Default für Piketdienst / Ygnis PM:
 * - NONE / A → standardmässig deaktiviert
 * - B / C    → standardmässig aktiviert
 */
export function defaultActiveForContract(contract: string | null | undefined): boolean {
  return contract === 'B' || contract === 'C'
}

export async function ensureSystemTemplateRecipientsForAnlage(anlageId: string): Promise<void> {
  const systemTemplates = await p.internalAlarmRecipientTemplate.findMany({
    where: { isSystem: true },
    orderBy: { sortOrder: 'asc' },
  })
  if (systemTemplates.length === 0) return

  const anlage = await p.anlage.findUnique({ where: { id: anlageId }, select: { contract: true } })
  const defaultActive = defaultActiveForContract(anlage?.contract)

  const existing = await p.alarmRecipient.findMany({
    where: { anlageId, templateId: { in: systemTemplates.map((t: { id: string }) => t.id) } },
    select: { templateId: true },
  })
  const have = new Set(existing.map((r: { templateId: string | null }) => r.templateId))

  for (const t of systemTemplates) {
    if (have.has(t.id)) continue
    await p.alarmRecipient.create({
      data: {
        anlageId,
        type: 'EMAIL',
        target: '', // kommt aus Template
        label: t.label,
        priorities: [], // kommen aus Template
        delayMinutes: 0, // kommt aus Template
        schedule: undefined,
        isActive: defaultActive,
        isInternal: true,
        templateId: t.id,
      },
    })
  }
}

/** Setzt Piketdienst/Ygnis PM auf den Contract-Default dieser Anlage. */
export async function applyContractDefaultsToSystemRecipients(anlageId: string): Promise<void> {
  const anlage = await p.anlage.findUnique({ where: { id: anlageId }, select: { contract: true } })
  if (!anlage) return
  const defaultActive = defaultActiveForContract(anlage.contract)
  await p.alarmRecipient.updateMany({
    where: { anlageId, isInternal: true, template: { isSystem: true } },
    data: { isActive: defaultActive },
  })
}

/** Einmaliger Backfill beim Server-Start: jede Anlage bekommt die System-Rows. */
export async function ensureSystemTemplateRecipientsForAllAnlagen(): Promise<void> {
  const anlagen = await prisma.anlage.findMany({ select: { id: true } })
  for (const a of anlagen) {
    try {
      await ensureSystemTemplateRecipientsForAnlage(a.id)
    } catch (err) {
      console.error(`[InternalAlarmTemplates] ensure failed for anlage ${a.id}:`, err)
    }
  }
  console.log(`[InternalAlarmTemplates] System-Template-Rows sichergestellt für ${anlagen.length} Anlage(n).`)
}
