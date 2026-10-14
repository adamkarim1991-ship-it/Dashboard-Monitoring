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
  console.log('status:', res.status)
  console.log('success:', j.success, '| expiresIn:', j.expiresIn)
}
main().finally(() => prisma.$disconnect())
