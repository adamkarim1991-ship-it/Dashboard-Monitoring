import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const jaktim = await prisma.cluster.findFirst({ where: { code: 'JKTIM' } })
    || await prisma.cluster.findFirst()
  if (!jaktim) return console.log('Cluster tidak ada')

  const hubs = [
    { code: 'CAKUNG',   name: 'Hub Cakung' },
    { code: 'CIPINANG', name: 'Hub Cipinang' },
    { code: 'PULOGADUNG', name: 'Hub Pulogadung' },
  ]
  for (const h of hubs) {
    await prisma.hub.upsert({
      where: { code: h.code },
      update: {},
      create: { code: h.code, name: h.name, clusterId: jaktim.id },
    })
    console.log('✅ Hub:', h.name)
  }
}
main().finally(() => prisma.$disconnect())
