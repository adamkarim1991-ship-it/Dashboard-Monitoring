import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const spv = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  const mgr = await prisma.user.findUnique({ where: { email: 'manager@goto.com' } })

  if (!spv?.hmsToken) { console.log('❌ SPV tidak punya token'); return }
  if (!mgr) { console.log('❌ Manager tidak ada'); return }

  await prisma.user.update({
    where: { id: mgr.id },
    data: { hmsToken: spv.hmsToken },
  })

  console.log('✅ Token SPV di-copy ke Manager')
  console.log('   SPV token length:', spv.hmsToken.length)
  console.log('   Manager sekarang:', mgr.email)
}
main().finally(() => prisma.$disconnect())
