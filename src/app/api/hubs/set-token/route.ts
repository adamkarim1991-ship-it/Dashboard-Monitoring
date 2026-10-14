import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  let body: {
    hubId?: string        // hmsHubId
    token?: string
    refreshToken?: string | null
    expiresAt?: number | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { hubId, token, refreshToken, expiresAt } = body
  if (!hubId || !token || token.length < 100) {
    return NextResponse.json({ error: 'Invalid hubId or token' }, { status: 400 })
  }

  const hub = await prisma.hub.findUnique({ where: { hmsHubId: hubId } })
  if (!hub) return NextResponse.json({ error: 'Hub not found' }, { status: 404 })

  await prisma.hub.update({
    where: { id: hub.id },
    data: {
      hmsToken: token,
      hmsTokenUpdatedAt: new Date(),
      hmsRefreshToken: refreshToken ?? undefined,
      hmsTokenExpiresAt: expiresAt ? new Date(Number(expiresAt)) : undefined,
    },
  })

  console.log(`[hub-set-token] ✅ ${hub.name} (${hubId})`)
  return NextResponse.json({ success: true, hub: hub.name })
}
