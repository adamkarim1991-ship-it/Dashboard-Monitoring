import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  let body: {
    hubId?: string
    hubName?: string
    token?: string
    refreshToken?: string | null
    expiresAt?: number | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { hubId, hubName, token, refreshToken, expiresAt } = body
  if (!token || token.length < 100) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }
  if (!hubId && !hubName) {
    return NextResponse.json({ error: 'hubId or hubName required' }, { status: 400 })
  }

  // Cari hub: prioritas hubName match, fallback hmsHubId
  let hub = null
  if (hubName) hub = await prisma.hub.findFirst({ where: { name: hubName } })
  if (!hub && hubId) hub = await prisma.hub.findUnique({ where: { hmsHubId: hubId } })
  if (!hub) return NextResponse.json({ error: 'Hub not found', hubId, hubName }, { status: 404 })

  await prisma.hub.update({
    where: { id: hub.id },
    data: {
      hmsToken: token,
      hmsTokenUpdatedAt: new Date(),
      hmsRefreshToken: refreshToken ?? undefined,
      hmsTokenExpiresAt: expiresAt ? new Date(Number(expiresAt)) : undefined,
    },
  })

  console.log(`[hub-set-token] ✅ ${hub.name} (id: ${hubId}, name: ${hubName})`)
  return NextResponse.json({ success: true, hub: hub.name })
}
