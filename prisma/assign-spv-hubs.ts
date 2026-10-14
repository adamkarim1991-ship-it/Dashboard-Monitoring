import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const spv = await prisma.user.findUnique({
    where: { email: 'spv.timur@goto.com' },
  })
  if (!spv) { console.log('❌ SPV tidak ada'); return }

  console.log('SPV ID:', spv.id)

  const allHubs = await prisma.hub.findMany()
  console.log(`Total hub: ${allHubs.length}\n`)

  // Cek nama tabel pivot dari Prisma
  const userHubsModel = (prisma as any).userHub
  if (!userHubsModel) {
    console.log('❌ Model userHub tidak ada di Prisma Client')
    return
  }

  for (const hub of allHubs) {
    const exists = await userHubsModel.findFirst({
      where: { userId: spv.id, hubId: hub.id },
    })
    if (exists) { console.log('⏭️  Sudah:', hub.name); continue }
    await userHubsModel.create({
      data: { userId: spv.id, hubId: hub.id },
    })
    console.log('✅ Assign:', hub.name)
  }

  const total = await userHubsModel.count({ where: { userId: spv.id } })
  console.log(`\n🎯 SPV sekarang punya akses ke ${total} hub`)
}
main().catch(e => console.error('ERROR:', e.message)).finally(() => prisma.$disconnect())
