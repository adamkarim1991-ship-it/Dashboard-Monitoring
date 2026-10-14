import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { refreshUserToken } from '@/app/api/auth/refresh-hms/route'

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const threshold = new Date(Date.now() + 6 * 60 * 60 * 1000)
  const users = await prisma.user.findMany({
    where: {
      hmsRefreshToken: { not: null },
      hmsToken: { not: null },
      OR: [
        { hmsTokenExpiresAt: { lte: threshold } },
        { hmsTokenExpiresAt: null },
      ],
    },
    select: { id: true, email: true },
  })
  const results: any[] = []
  for (const u of users) {
    const r = await refreshUserToken(u.id)
    results.push({ email: u.email, success: r.success, error: r.error })
  }
  return NextResponse.json({
    ok: true,
    refreshed: results.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  })
}