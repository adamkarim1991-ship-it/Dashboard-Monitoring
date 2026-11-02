import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const API_ID_MAIN = "7564027893345453074"
const PAYMENT_TYPES = '["cashless","cod"]'
const SERVICE_TYPES = '["INS","SDS","REG","NDD","OTHERS"]'

function toWIB() { return new Date(Date.now() + 7 * 60 * 60 * 1000) }
function formatDateYMD(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}
function getMainCurrDate() {
  const d = toWIB(); d.setUTCDate(d.getUTCDate() - 1)
  return `${formatDateYMD(d)} 17:00:00`
}
function getTodayDate() { return formatDateYMD(toWIB()) }

async function callHMS(token: string, apiId: string, params: any) {
  const res = await fetch(`${process.env.HMS_BASE_URL}/dc/v1/oneservice`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-location': 'Asia/Jakarta',
      'x-request-source': 'web',
      Origin: 'https://gtl-id.tokgistic.com',
    },
    body: JSON.stringify({ api_id: apiId, params }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HMS ${res.status}`)
  const json = await res.json()
  if (json.code !== 200) throw new Error(`HMS code ${json.code}`)
  return json
}

function parseCompact(dataStr: string, fields: { name: string }[]) {
  const rows = JSON.parse(dataStr)
  if (rows.length === 0) return null
  const obj: any = {}
  const row = rows[0]
  fields.forEach((f, i) => { obj[f.name] = row[i] })
  return obj
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const user = await prisma.user.findFirst({
    where: { hmsToken: { not: null } },
    select: { hmsToken: true, email: true },
  })
  if (!user?.hmsToken) {
    return NextResponse.json({ error: 'No HMS token available' }, { status: 400 })
  }

  const today = getTodayDate()
  const currDate = getMainCurrDate()
  const hubs = await prisma.hub.findMany({ select: { id: true, name: true, hmsHubId: true } })
  const results: any[] = []

  for (const hub of hubs) {
    try {
      const res = await callHMS(user.hmsToken!, API_ID_MAIN, {
        hub_ids: JSON.stringify([hub.hmsHubId]),
        curr_date: currDate,
        payment_types: PAYMENT_TYPES,
        service_types: SERVICE_TYPES,
      })
      const main = parseCompact(res.data.data, res.data.fields)
      if (!main) { results.push({ hub: hub.name, error: 'Empty' }); continue }

      const justArrived = Number(main.just_arrived) || 0
      const backlog = Number(main.backlog) || 0
      const todayVolume = justArrived + backlog
      const numerator =
        (Number(main.ongoing_delivery) || 0) +
        (Number(main.delivered) || 0) +
        (Number(main.ftd) || 0) +
        (Number(main.others) || 0)
      const cfValue = todayVolume > 0 ? Math.min((numerator / todayVolume) * 100, 100) : 0

      // The 08:00 snapshot owns the denominator. A re-run may refresh the
      // numerator but must never move the locked denominator again.
      const existing = await prisma.cleanFloorSnapshot.findUnique({
        where: { facility_date: { facility: hub.hmsHubId, date: today } },
      })

      if (existing) {
        const lockedValue =
          existing.denominator > 0
            ? Math.min((numerator / existing.denominator) * 100, 100)
            : 0
        await prisma.cleanFloorSnapshot.update({
          where: { facility_date: { facility: hub.hmsHubId, date: today } },
          data: {
            value: lockedValue,
            numerator,
            delivered: Number(main.delivered) || 0,
            ongoing: Number(main.ongoing_delivery) || 0,
            ftd: Number(main.ftd) || 0,
            others: Number(main.others) || 0,
          },
        })
        results.push({
          hub: hub.name,
          cf: lockedValue.toFixed(2) + '%',
          locked_denominator: existing.denominator,
          note: 'lock kept',
        })
        continue
      }

      await prisma.cleanFloorSnapshot.create({
        data: {
          facility: hub.hmsHubId,
          date: today,
          value: cfValue,
          numerator,
          denominator: todayVolume,
          delivered: Number(main.delivered) || 0,
          ongoing: Number(main.ongoing_delivery) || 0,
          ftd: Number(main.ftd) || 0,
          others: Number(main.others) || 0,
        },
      })

      results.push({
        hub: hub.name,
        cf: cfValue.toFixed(2) + '%',
        locked_denominator: todayVolume,
        note: 'lock created',
      })
    } catch (e: any) {
      results.push({ hub: hub.name, error: e.message })
    }
  }

  return NextResponse.json({ ok: true, date: today, count: hubs.length, results })
}
