import { prisma } from '../src/db/prisma'
import { LUZERN_HOLIDAY_RULES } from '../src/lib/holidays'

async function main() {
  let added = 0
  for (const r of LUZERN_HOLIDAY_RULES) {
    const result = await prisma.$executeRawUnsafe(
      `INSERT INTO holiday_rules (id, key, label, type, fixed_month, fixed_day, easter_offset, region, is_active, sort_order, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3::"HolidayRuleType", $4, $5, $6, $7, true, $8, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, region = EXCLUDED.region`,
      r.key, r.label, r.type,
      r.fixedMonth ?? null, r.fixedDay ?? null, r.easterOffset ?? null,
      r.region ?? null, r.sortOrder,
    )
    added += result
  }
  console.log(`Upserted ${added} holiday rules`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
