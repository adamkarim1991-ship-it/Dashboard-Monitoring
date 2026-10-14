import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  const res = await fetch('https://dashboard-monitoring-beige.vercel.app/api/auth/refresh-hms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: u!.id }),
  })
  const j = await res.json()
  console.log(JSON.stringify(j, null, 2))

  const db = await prisma.user.findUnique({
    where: { id: u!.id },
    select: { hmsRefreshToken: true, hmsToken: true, hmsTokenExpiresAt: true, hmsRefreshTokenUpdatedAt: true },
  })
  console.log('\n=== DB SEKARANG ===')
  console.log('access len:', db?.hmsToken?.length)
  console.log('refresh len:', db?.hmsRefreshToken?.length)
  console.log('expires:', db?.hmsTokenExpiresAt?.toISOString())
  console.log('refresh updated:', db?.hmsRefreshTokenUpdatedAt?.toISOString())
}
main().finally(() => prisma.$disconnect())
