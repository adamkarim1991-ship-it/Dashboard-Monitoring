import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    hubName?: string
    hubId?: string
    token?: string
    refreshToken?: string | null
    expiresAt?: number | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { hubName, hubId, token, refreshToken, expiresAt } = body

  if (!token || token.length < 100) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }
  if (!hubName && !hubId) {
    return NextResponse.json({ error: 'hubName or hubId required' }, { status: 400 })
  }

  let hub = null
  if (hubName) hub = await prisma.hub.findFirst({ where: { name: hubName } })
  if (!hub && hubId) hub = await prisma.hub.findUnique({ where: { hmsHubId: hubId } })
  if (!hub) return NextResponse.json({ error: 'Hub not found', hubName, hubId }, { status: 404 })

  const membership = await prisma.userHub.findUnique({
    where: { userId_hubId: { userId: session.user.id, hubId: hub.id } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden: this account is not assigned to the target hub.' }, { status: 403 })
  }

  await prisma.hub.update({
    where: { id: hub.id },
    data: {
      hmsToken: token,
      hmsTokenUpdatedAt: new Date(),
      hmsRefreshToken: refreshToken ?? undefined,
      hmsTokenExpiresAt: expiresAt ? new Date(Number(expiresAt)) : undefined,
    },
  })

  console.log('[hub-set-token] OK ' + hub.name + ' by ' + session.user.id)
  return NextResponse.json({ success: true, hub: hub.name })
}