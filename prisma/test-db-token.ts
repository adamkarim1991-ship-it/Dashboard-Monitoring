import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function decodeJwt(t: string) {
  return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString())
}

async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  const token = u!.hmsToken!
  const p = decodeJwt(token)
  const auth = p['x-user-authorization'] || {}

  console.log('Token length:', token.length)
  console.log('x-token-id:', auth['x-token-id'])
  console.log('x-device-id:', auth['x-device-id'])
  console.log('x-facility-id:', auth['x-facility-id'])
  console.log('exp:', new Date(p.exp * 1000).toLocaleString())
  console.log('now:', new Date().toLocaleString())

  const now = new Date()
  const wib = new Date(now.getTime() + 7 * 3600 * 1000)
  const fromTs = Math.floor((Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) - 7*3600*1000) / 1000)
  const toTs = Math.floor((Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 8, 0, 0) - 7*3600*1000) / 1000)

  console.log('\nTest task/search page 1...')
  const res = await fetch('https://gtl-id.tokgistic.com/api/hms/v1/ui/task/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-token-id': String(auth['x-token-id'] || ''),
      'x-device-id': String(auth['x-device-id'] || ''),
      'x-user-id': String(auth['x-user-id'] || ''),
      'x-facility-id': String(auth['x-facility-id'] || ''),
      'x-company-id': String(auth['x-company-id'] || ''),
      'x-location': 'Asia/Jakarta',
      'x-request-source': 'web',
      'Origin': 'https://gtl-id.tokgistic.com',
    },
    body: JSON.stringify({
      filters: { received_at_from: fromTs, received_at_to: toTs },
      page: 1, size: 5,
    }),
  })
  console.log('Status:', res.status)
  const text = await res.text()
  console.log('Body:', text.slice(0, 300))
}
main().finally(() => prisma.$disconnect())
