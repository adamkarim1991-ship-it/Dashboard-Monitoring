import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  const token = u!.hmsToken!
  console.log('Token preview:', token.slice(0, 40) + '...')
  console.log('Token length:', token.length)

  // Test 1: hit HMS langsung (sama seperti kode Vercel)
  console.log('\n[1] Test HMS /dc/v1/oneservice...')
  const res1 = await fetch('https://gtl-id.tokgistic.com/dc/v1/oneservice', {
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
  console.log('Status:', res1.status)
  const text = await res1.text()
  console.log('Response:', text.slice(0, 300))
}
main().finally(() => prisma.$disconnect())
