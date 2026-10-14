import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  await prisma.user.update({
    where: { email: 'spv.timur@goto.com' },
    data: {
      hmsToken: null,
      hmsRefreshToken: null,
      hmsTokenExpiresAt: null,
      hmsTokenUpdatedAt: null,
      hmsRefreshTokenUpdatedAt: null,
    },
  })
  console.log('✅ Token SPV dihapus dari DB')
}
main().finally(() => prisma.$disconnect())
