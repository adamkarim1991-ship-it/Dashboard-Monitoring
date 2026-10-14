import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const users = await prisma.user.findMany({
    select: { email: true, name: true, role: true, hmsToken: true, hmsRefreshToken: true },
  })
  console.log('=== SEMUA USER ===\n')
  users.forEach(u => {
    console.log(`${u.email} | ${u.name} | ${u.role}`)
    console.log(`  access:  ${u.hmsToken?.length || 0} chars`)
    console.log(`  refresh: ${u.hmsRefreshToken?.length || 0} chars`)
    console.log('')
  })
}
main().finally(() => prisma.$disconnect())
