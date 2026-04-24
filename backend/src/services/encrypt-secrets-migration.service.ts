import { prisma } from '../db/prisma'
import { SENSITIVE_SETTING_KEYS } from '../routes/settings.router'
import { encryptSecret, isEncrypted } from '../lib/secret-crypto'

/**
 * Einmalige Migration beim App-Start: bestehende sensible SystemSetting-Werte,
 * die noch im Klartext vorliegen, werden in-place verschlüsselt. Kollidiert
 * niemand mit dem Schreiben – der DB-Write ist idempotent, und wenn parallel
 * jemand den Wert via PATCH updated, gewinnt der letzte Write.
 *
 * Läuft synchron am Start (nach DB-Connect), damit wir sicher sein können,
 * dass ab jetzt alle neuen Reads / GETs den decrypted Pfad nutzen und in
 * einem DB-Dump keine Klartexte mehr auftauchen.
 */
export async function runSecretsEncryptionMigration(): Promise<void> {
  try {
    const sensitiveKeys = Array.from(SENSITIVE_SETTING_KEYS)
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: sensitiveKeys } },
    })

    let migrated = 0
    for (const row of rows) {
      if (!row.value || isEncrypted(row.value)) continue
      await prisma.systemSetting.update({
        where: { key: row.key },
        data: { value: encryptSecret(row.value) },
      })
      migrated += 1
    }
    if (migrated > 0) {
      console.log(`[secrets-migration] ${migrated} sensible Settings-Werte verschlüsselt`)
    }
  } catch (e) {
    // Migration ist best-effort – bei Fehler loggen wir, schlagen aber nicht
    // die App ab, weil Settings dann im Legacy-Modus (unverschlüsselt lesbar)
    // weiterlaufen würden.
    console.error('[secrets-migration] Fehler:', (e as Error).message)
  }
}
