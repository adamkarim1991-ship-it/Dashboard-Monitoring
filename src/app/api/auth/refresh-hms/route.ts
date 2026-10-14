import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const HMS_BASE = process.env.HMS_BASE_URL || 'https://gtl-id.tokgistic.com'
const CLIENT_ID = 'gtl-frontend'

export async function refreshHmsToken(oldAccessToken: string, refreshToken: string) {
  try {
    const res = await fetch(`${HMS_BASE}/auth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${oldAccessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ grant: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `HMS ${res.status}: ${text.slice(0, 200)}` }
    }
    const json = await res.json()
    if (!json.access_token) {
      return { success: false, error: `No access_token: ${JSON.stringify(json).slice(0, 200)}` }
    }
    return {
      success: true,
      accessToken: json.access_token as string,
      refreshToken: (json.refresh_token as string) || undefined,
      expiresIn: Number(json.expires_in) || 86400,
    }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

export async function refreshUserToken(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, hmsToken: true, hmsRefreshToken: true },
  })
  if (!user) return { success: false, error: 'User not found' }
  if (!user.hmsToken || !user.hmsRefreshToken) return { success: false, error: 'Missing tokens' }

  const result = await refreshHmsToken(user.hmsToken, user.hmsRefreshToken)
  if (!result.success) return result

  await prisma.user.update({
    where: { id: user.id },
    data: {
      hmsToken: result.accessToken,
      hmsRefreshToken: result.refreshToken || user.hmsRefreshToken,
      hmsTokenExpiresAt: new Date(Date.now() + result.expiresIn! * 1000),
      hmsRefreshTokenUpdatedAt: new Date(),
      hmsTokenUpdatedAt: new Date(),
    },
  })
  return result
}

export async function POST(req: NextRequest) {
  const isCron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  let body: any = {}
  try { body = await req.json() } catch {}

  if (body.userId && !isCron) {
    const result = await refreshUserToken(body.userId)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  }
  if (!isCron) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const users = await prisma.user.findMany({
    where: { hmsRefreshToken: { not: null }, hmsToken: { not: null } },
    select: { id: true, email: true },
  })
  const results: any[] = []
  for (const u of users) {
    const r = await refreshUserToken(u.id)
    results.push({ email: u.email, success: r.success, error: r.error })
  }
  return NextResponse.json({
    ok: true,
    count: users.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  })
}