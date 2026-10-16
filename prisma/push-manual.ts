import { PrismaClient } from '@prisma/client'
import fs from 'fs'
const prisma = new PrismaClient()

async function main() {
  const token = fs.readFileSync('prisma/token-temp.txt', 'utf-8').trim()
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
  const facilityId = String(payload['x-user-authorization']['x-facility-id'])
  console.log('Facility ID:', facilityId)

  const hub = await prisma.hub.findFirst({ where: { name: 'GTL Pasar Rebo Hub' } })
  if (!hub) { console.log('❌ Hub tidak ditemukan'); return }

  await prisma.hub.update({
    where: { id: hub.id },
    data: { hmsToken: token, hmsTokenUpdatedAt: new Date() },
  })
  console.log('✅ Token ter-push untuk GTL Pasar Rebo Hub')

  fs.unlinkSync('prisma/token-temp.txt')
}
main().finally(() => prisma.$disconnect())
