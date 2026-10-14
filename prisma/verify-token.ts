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
  console.log('Last 30:', token.slice(-30))
  console.log('x-token-id:', auth['x-token-id'])
  console.log('exp:', new Date(p.exp * 1000).toLocaleString())

  const now = new Date()
  const wib = new Date(now.getTime() + 7 * 3600 * 1000)
  const fromTs = Math.floor((Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) - 7*3600*1000) / 1000)
  const toTs = Math.floor((Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 8, 0, 0) - 7*3600*1000) / 1000)

  console.log('\nTest dari PowerShell (Node fetch)...')
  const res = await fetch('https://gtl-id.tokgistic.com/api/hms/v1/ui/task/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-token-id': String(auth['x-token-id'] || ''),
      'x-device-id': String(auth['x-device-id'] || ''),
      'x-user-id': String(auth['x-user-id'] || ''),
      'x-facility-id': String(auth['x-facility-id'] || ''),
      'x-company-id': String(auth['x-company-id'] || ''),
      'x-location': 'Asia/Jakarta',
      'x-request-source': 'web',
    },
    body: JSON.stringify({ filters: { received_at_from: fromTs, received_at_to: toTs }, page: 1, size: 5 }),
  })
  console.log('Status:', res.status)
  if (res.status !== 200) {
    console.log('Body:', (await res.text()).slice(0, 300))
  } else {
    console.log('✅ 200 OK — token DB valid')
  }
}
main().finally(() => prisma.$disconnect())
