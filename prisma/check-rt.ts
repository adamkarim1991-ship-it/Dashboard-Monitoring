import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  const rt = u?.hmsRefreshToken || ''
  console.log('DB refresh len:', rt.length)
  console.log('DB first 40:  ', rt.slice(0, 40))
  console.log('DB last 30:   ', rt.slice(-30))
}
main().finally(() => prisma.$disconnect())
