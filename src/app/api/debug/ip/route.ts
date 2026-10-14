import { NextResponse } from 'next/server'

export async function GET() {
  const out: any = {}
  try {
    const ipRes = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
    out.ipify = await ipRes.json()
  } catch (e: any) { out.ipify = e.message }
  try {
    const geoRes = await fetch('https://ipapi.co/json/', { cache: 'no-store' })
    const g = await geoRes.json()
    out.geo = { ip: g.ip, country: g.country_name, region: g.region, city: g.city }
  } catch (e: any) { out.geo = e.message }
  out.vercel = {
    region: process.env.VERCEL_REGION,
    url: process.env.VERCEL_URL,
  }
  return NextResponse.json(out)
}
