import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const clusters = await prisma.cluster.findMany({ include: { hubs: true } })
  console.log('=== CLUSTERS ===')
  clusters.forEach(c => {
    console.log(`  ${c.name} (${c.id}) → ${c.hubs.length} hub`)
    c.hubs.forEach(h => console.log(`     - ${h.name} (${h.id})`))
  })
}
main().finally(() => prisma.$disconnect())
