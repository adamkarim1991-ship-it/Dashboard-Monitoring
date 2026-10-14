import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function decodeJWT(t: string) {
  return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString())
}

async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  const token = u!.hmsToken!
  const rt = u!.hmsRefreshToken!

  const rtPayload = decodeJWT(rt)
  console.log('Refresh token payload:', JSON.stringify(rtPayload, null, 2))

  const deviceId = rtPayload['x-device-id']
  const tokenId = rtPayload['x-token-id']
  const facilityId = rtPayload['facility_id']

  console.log('\nExtracted:')
  console.log('  x-device-id:', deviceId)
  console.log('  x-token-id: ', tokenId)
  console.log('  facility_id:', facilityId)

  console.log('\n[Test A] HMS TANPA header tambahan...')
  const resA = await fetch('https://gtl-id.tokgistic.com/dc/v1/oneservice', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: '*/*',
      'x-location': 'Asia/Jakarta',
      'x-request-source': 'web',
      Origin: 'https://gtl-id.tokgistic.com',
      Referer: 'https://gtl-id.tokgistic.com/tms/operation-performance-central',
    },
    body: JSON.stringify({
      api_id: '7564027893345453074',
      params: {
        hub_ids: JSON.stringify(['460450593288']),
        curr_date: '2026-10-13 17:00:00',
        payment_types: '["cashless","cod"]',
        service_types: '["INS","SDS","REG","NDD","OTHERS"]',
      },
    }),
  })
  console.log('  Status:', resA.status)

  console.log('\n[Test B] HMS DENGAN header x-device-id + x-token-id...')
  const resB = await fetch('https://gtl-id.tokgistic.com/dc/v1/oneservice', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: '*/*',
      'x-location': 'Asia/Jakarta',
      'x-request-source': 'web',
      'x-device-id': deviceId || '',
      'x-token-id': tokenId || '',
      Origin: 'https://gtl-id.tokgistic.com',
      Referer: 'https://gtl-id.tokgistic.com/tms/operation-performance-central',
    },
    body: JSON.stringify({
      api_id: '7564027893345453074',
      params: {
        hub_ids: JSON.stringify(['460450593288']),
        curr_date: '2026-10-13 17:00:00',
        payment_types: '["cashless","cod"]',
        service_types: '["INS","SDS","REG","NDD","OTHERS"]',
      },
    }),
  })
  console.log('  Status:', resB.status)
  const textB = await resB.text()
  console.log('  Response:', textB.slice(0, 300))
}
main().finally(() => prisma.$disconnect())
