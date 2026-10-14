import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const hubNames = [
  'GTL Ciracas Hub',
  'GTL Duren Sawit Hub',
  'GTL Kramatjati Hub',
  'GTL Matraman Hub',
  'GTL Pasar Rebo Hub',
  'GTL Pulogadung Hub',
  'GTL Senen Hub',
  'GTL Tanahabang Hub',
]

async function main() {
  const cluster = await prisma.cluster.findFirst()
  if (!cluster) { console.log('❌ Tidak ada cluster'); return }
  console.log('Cluster:', cluster.name, '\n')

  for (const name of hubNames) {
    const existing = await prisma.hub.findFirst({ where: { name } })
    if (existing) { console.log('⏭️  Sudah ada:', name); continue }
    await prisma.hub.create({
      data: {
        name,
        hmsHubId: name,
        clusterId: cluster.id,
      },
    })
    console.log('✅ Ditambahkan:', name)
  }

  const total = await prisma.hub.count()
  console.log(`\n🎯 Total hub: ${total}`)
}
main().finally(() => prisma.$disconnect())
