import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function decodeJwt(t: string) {
  return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString())
}

async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'afifeffendi@goto.com' } })
  const token = u!.hmsToken!
  const p = decodeJwt(token)
  const auth = p['x-user-authorization'] || {}

  console.log('x-facility-id:', auth['x-facility-id'])
  console.log('exp:', new Date(p.exp * 1000).toLocaleString())

  const res = await fetch('https://gtl-id.tokgistic.com/dc/v1/oneservice', {
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
    body: JSON.stringify({
      api_id: '7564027893345453074',
      params: {
        hub_ids: JSON.stringify(['460450593288']),
        curr_date: '2026-10-14 17:00:00',
        payment_types: '["cashless","cod"]',
        service_types: '["INS","SDS","REG","NDD","OTHERS"]',
      },
    }),
  })
  console.log('HMS status:', res.status)
}
main().finally(() => prisma.$disconnect())
