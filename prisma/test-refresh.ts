import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'spv.timur@goto.com' },
    select: { id: true, email: true },
  })
  if (!user) { console.log('User not found'); return }
  console.log('USER ID:', user.id)

  console.log('\nCalling /api/auth/refresh-hms...')
  const res = await fetch('https://dashboard-monitoring-production.up.railway.app/api/auth/refresh-hms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user.id }),
  })
  const json = await res.json()
  console.log('Status:', res.status)
  console.log('Response:', JSON.stringify(json, null, 2).slice(0, 500))

  if (json.success) {
    console.log('\n✅ Refresh berhasil! Cek DB...')
    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: { hmsToken: true, hmsRefreshToken: true, hmsTokenExpiresAt: true, hmsTokenUpdatedAt: true },
    })
    console.log('  access len: ', updated?.hmsToken?.length)
    console.log('  refresh len:', updated?.hmsRefreshToken?.length)
    console.log('  expires:    ', updated?.hmsTokenExpiresAt?.toISOString())
    console.log('  updated at: ', updated?.hmsTokenUpdatedAt?.toISOString())
  }
}
main().catch(e => console.error('ERROR:', e.message)).finally(() => prisma.$disconnect())
