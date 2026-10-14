import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const HUBS = [
  { name: "GTL Ciracas Hub", hmsHubId: "294" },
  { name: "GTL Duren Sawit Hub", hmsHubId: "272" },
  { name: "GTL Jatinegara Hub", hmsHubId: "460450593288" },
  { name: "GTL Kramatjati Hub", hmsHubId: "303" },
  { name: "GTL Matraman Hub", hmsHubId: "460450593308" },
  { name: "GTL Pasar Rebo Hub", hmsHubId: "460450593295" },
  { name: "GTL Pulogadung Hub", hmsHubId: "275" },
  { name: "GTL Senen Hub", hmsHubId: "460450593312" },
  { name: "GTL Tanahabang Hub", hmsHubId: "302" },
]

async function main() {
  for (const h of HUBS) {
    const existing = await prisma.hub.findFirst({ where: { name: h.name } })
    if (!existing) {
      console.log('⚠️  Tidak ada:', h.name)
      continue
    }
    if (existing.hmsHubId === h.hmsHubId) {
      console.log('⏭️  Sudah benar:', h.name, '→', h.hmsHubId)
      continue
    }
    await prisma.hub.update({
      where: { id: existing.id },
      data: { hmsHubId: h.hmsHubId },
    })
    console.log('✅ Update:', h.name, '→', h.hmsHubId)
  }

  console.log('\n=== HASIL AKHIR ===')
  const all = await prisma.hub.findMany({ orderBy: { name: 'asc' } })
  all.forEach(h => console.log(`  ${h.name} → ${h.hmsHubId}`))
}
main().finally(() => prisma.$disconnect())
