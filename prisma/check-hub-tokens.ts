import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const hubs = await prisma.hub.findMany({
    select: { name: true, hmsHubId: true, hmsToken: true, hmsTokenUpdatedAt: true },
    orderBy: { name: 'asc' },
  })
  console.log('=== STATUS TOKEN PER HUB ===\n')
  hubs.forEach(h => {
    const hasToken = h.hmsToken ? '✅' : '❌'
    const updated = h.hmsTokenUpdatedAt?.toISOString() || 'never'
    console.log(`${hasToken} ${h.name} (hmsHubId: ${h.hmsHubId}) — updated: ${updated}`)
  })
}
main().finally(() => prisma.$disconnect())
