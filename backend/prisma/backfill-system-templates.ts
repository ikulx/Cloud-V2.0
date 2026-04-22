import { ensureSystemTemplateRecipientsForAllAnlagen } from '../src/services/internal-alarm-templates.service'
import { prisma } from '../src/db/prisma'

async function main() {
  await ensureSystemTemplateRecipientsForAllAnlagen()
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
