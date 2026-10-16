import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function decodeJwt(t: string) {
  return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString())
}

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

async function main() {
  const u = await prisma.user.findUnique({ where: { email: 'spv.timur@goto.com' } })
  const token = u!.hmsToken!
  const p = decodeJwt(token)
  const auth = p['x-user-authorization'] || {}

  const wib = new Date(Date.now() + 7 * 3600 * 1000)
  const fromTs = Math.floor((Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 0, 0, 0) - 7*3600*1000) / 1000)
  const toTs = Math.floor((Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 8, 0, 0) - 7*3600*1000) / 1000)

  const baseHeaders: any = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'x-token-id': String(auth['x-token-id'] || ''),
    'x-device-id': String(auth['x-device-id'] || ''),
    'x-user-id': String(auth['x-user-id'] || ''),
    'x-facility-id': String(auth['x-facility-id'] || ''),
    'x-company-id': String(auth['x-company-id'] || ''),
    'x-location': 'Asia/Jakarta',
    'x-request-source': 'web',
    'Origin': 'https://gtl-id.tokgistic.com',
    'Referer': 'https://gtl-id.tokgistic.com/hms/order-management',
  }

  const body = JSON.stringify({ filters: { received_at_from: fromTs, received_at_to: toTs }, page: 1, size: 5 })

  console.log('[A] Tanpa User-Agent:')
  const rA = await fetch('https://gtl-id.tokgistic.com/api/hms/v1/ui/task/search', {
    method: 'POST', headers: baseHeaders, body,
  })
  console.log('  Status:', rA.status)

  console.log('\n[B] Dengan User-Agent Chrome:')
  const rB = await fetch('https://gtl-id.tokgistic.com/api/hms/v1/ui/task/search', {
    method: 'POST', headers: { ...baseHeaders, 'User-Agent': CHROME_UA }, body,
  })
  console.log('  Status:', rB.status)

  console.log('\n[C] Dengan User-Agent Chrome + sec-ch-ua headers:')
  const rC = await fetch('https://gtl-id.tokgistic.com/api/hms/v1/ui/task/search', {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'User-Agent': CHROME_UA,
      'sec-ch-ua': '"Chromium";v="140", "Not=A?Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
    body,
  })
  console.log('  Status:', rC.status)
}
main().finally(() => prisma.$disconnect())
