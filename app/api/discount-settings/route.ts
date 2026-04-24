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
  const body = await req.json()

  // Batch: array of { slug, label, discountPct }
  if (Array.isArray(body)) {
    for (const item of body) {
      if (typeof item.slug !== 'string' || typeof item.discountPct !== 'number') {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
      }
      if (item.discountPct < 0 || item.discountPct > 100) {
        return NextResponse.json({ error: 'discountPct must be 0–100' }, { status: 400 })
      }
    }
    await Promise.all(
      body.map((item: { slug: string; label: string; discountPct: number }) =>
        prisma.discountSetting.upsert({
          where: { slug: item.slug },
          update: { discountPct: item.discountPct },
          create: { slug: item.slug, label: item.label, discountPct: item.discountPct },
        })
      )
    )
    return NextResponse.json({ ok: true })
  }

  // Single: { slug, label?, discountPct }
  const { slug, discountPct, label } = body
  if (typeof slug !== 'string' || typeof discountPct !== 'number') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  if (discountPct < 0 || discountPct > 100) {
    return NextResponse.json({ error: 'discountPct must be 0–100' }, { status: 400 })
  }

  const setting = await prisma.discountSetting.upsert({
    where: { slug },
    update: { discountPct },
    create: { slug, label: label ?? slug, discountPct },
  })
  return NextResponse.json(setting)
}
