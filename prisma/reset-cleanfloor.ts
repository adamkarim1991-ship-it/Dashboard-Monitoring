import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function toWIBDateString() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}

async function main() {
  const today = toWIBDateString()
  console.log('Hapus snapshot tanggal:', today)

  const deleted = await prisma.cleanFloorSnapshot.deleteMany({
    where: { date: today },
  })
  console.log(`✅ ${deleted.count} snapshot dihapus`)
  console.log('   Refresh dashboard → Clean Floor akan dihitung ulang.')
}
main().finally(() => prisma.$disconnect())
