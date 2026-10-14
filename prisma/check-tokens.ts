import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      hmsTokenUpdatedAt: true,
      hmsRefreshTokenUpdatedAt: true,
      hmsTokenExpiresAt: true,
      hmsToken: true,
      hmsRefreshToken: true,
    },
  })
  console.log('=== STATUS TOKEN ===\n')
  users.forEach(u => {
    const accLen = u.hmsToken?.length || 0
    const refLen = u.hmsRefreshToken?.length || 0
    console.log(`${u.email}`)
    console.log(`  access:  ${accLen > 0 ? '✅' : '❌'} ${accLen} chars`)
    console.log(`  refresh: ${refLen > 0 ? '✅' : '❌'} ${refLen} chars`)
    console.log(`  expires: ${u.hmsTokenExpiresAt?.toISOString() || 'NOT SET'}`)
    console.log(`  token updated:   ${u.hmsTokenUpdatedAt?.toISOString() || 'never'}`)
    console.log(`  refresh updated: ${u.hmsRefreshTokenUpdatedAt?.toISOString() || 'never'}`)
    console.log('')
  })
}
main().finally(() => prisma.$disconnect())
