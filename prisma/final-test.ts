import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  if (!u) { console.log('User not found'); return }

  console.log('Sebelum refresh — cek DB:')
  const before = await prisma.user.findUnique({
    where: { id: u.id },
    select: { hmsToken: true, hmsRefreshToken: true, hmsTokenExpiresAt: true },
  })
  console.log('  access len: ', before?.hmsToken?.length)
  console.log('  refresh len:', before?.hmsRefreshToken?.length)
  console.log('  expires:    ', before?.hmsTokenExpiresAt?.toISOString())

  console.log('\nCalling /api/auth/refresh-hms...')
  const res = await fetch('https://dashboard-monitoring-production.up.railway.app/api/auth/refresh-hms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: u.id }),
  })
  const j = await res.json()
  console.log('status:', res.status)
  console.log('response:', JSON.stringify(j, null, 2).slice(0, 400))

  console.log('\nSesudah refresh — cek DB:')
  const after = await prisma.user.findUnique({
    where: { id: u.id },
    select: { hmsToken: true, hmsRefreshToken: true, hmsTokenExpiresAt: true, hmsTokenUpdatedAt: true },
  })
  console.log('  access len: ', after?.hmsToken?.length)
  console.log('  refresh len:', after?.hmsRefreshToken?.length)
  console.log('  expires:    ', after?.hmsTokenExpiresAt?.toISOString())
  console.log('  updated at: ', after?.hmsTokenUpdatedAt?.toISOString())
}
main().catch(e => console.error('ERROR:', e.message)).finally(() => prisma.$disconnect())
