import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const settings = await prisma.discountSetting.findMany({
    orderBy: { slug: 'asc' },
  })
  return NextResponse.json(settings)
}

export async function PATCH(req: NextRequest) {
  const { slug, discountPct } = await req.json()

  if (typeof slug !== 'string' || typeof discountPct !== 'number') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  if (discountPct < 0 || discountPct > 100) {
    return NextResponse.json({ error: 'discountPct must be 0–100' }, { status: 400 })
  }

  const setting = await prisma.discountSetting.upsert({
    where: { slug },
    update: { discountPct },
    create: { slug, label: slug, discountPct },
  })
  return NextResponse.json(setting)
}
