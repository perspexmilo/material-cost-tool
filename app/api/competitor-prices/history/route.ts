import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const COMPETITOR_LABELS: Record<string, string> = {
  'simply-plastics':        'Simply Plastics',
  'plastic-people':         'Plastic People',
  'cut-plastic-sheeting':   'Cut Plastic Sheeting',
  'sheet-plastics':         'Sheet Plastics',
  'plastic-sheet-shop':     'Plastic Sheet Shop',
  'plastic-sheets':         'Plastic Sheets',
  'wood-sheets':            'Wood Sheets',
  'cnc-creations':          'CNC Creations',
  'plastic-people-mdf':     'Plastic People',
  'cut-plastic-sheeting-mdf': 'Cut Plastic Sheeting',
  'just-mdf':               'Just MDF',
}

const MDF_PLY_MFC_SLUGS = new Set(['mdf-direct', 'ply-direct', 'mfc-direct'])

const PLASTIC_SLUGS = [
  'simply-plastics',
  'plastic-people',
  'cut-plastic-sheeting',
  'sheet-plastics',
  'plastic-sheet-shop',
  'plastic-sheets',
]

const WOOD_SLUGS = [
  'wood-sheets',
  'cnc-creations',
  'plastic-people-mdf',
  'cut-plastic-sheeting-mdf',
  'just-mdf',
  'mdf-direct',
  'ply-direct',
  'mfc-direct',
]

export async function GET(req: NextRequest) {
  const basketItemId = req.nextUrl.searchParams.get('basketItemId')
  const category = req.nextUrl.searchParams.get('category') ?? 'plastic'

  if (!basketItemId) {
    return NextResponse.json({ error: 'basketItemId required' }, { status: 400 })
  }

  const allowedSlugs = category === 'wood' ? WOOD_SLUGS : PLASTIC_SLUGS

  // One price per competitor per day — latest run if multiple happened same day
  const rows = await prisma.$queryRaw<Array<{
    competitor: string
    run_date: Date
    price_per_m2: string
  }>>`
    WITH ranked AS (
      SELECT
        cr.competitor,
        DATE_TRUNC('day', cr.run_at) AS run_date,
        cp.price_per_m2,
        ROW_NUMBER() OVER (
          PARTITION BY cr.competitor, DATE_TRUNC('day', cr.run_at)
          ORDER BY cr.run_at DESC
        ) AS rn
      FROM competitor_prices cp
      JOIN competitor_runs cr ON cp.run_id = cr.id
      WHERE cp.basket_item_id = ${basketItemId}
        AND cr.competitor = ANY(${allowedSlugs}::text[])
        AND cr.status IN ('success', 'partial')
        AND cp.price_per_m2 IS NOT NULL
    )
    SELECT competitor, run_date, price_per_m2
    FROM ranked
    WHERE rn = 1
    ORDER BY competitor, run_date ASC
  `

  // Group by competitor slug, merging mdf/ply/mfc-direct into one for wood
  const grouped = new Map<string, { label: string; points: { date: number; pricePerM2: number }[] }>()

  for (const row of rows) {
    const slug =
      category === 'wood' && MDF_PLY_MFC_SLUGS.has(row.competitor)
        ? 'mdf-ply-mfc-direct'
        : row.competitor
    const label =
      slug === 'mdf-ply-mfc-direct'
        ? 'MDF/Ply/MFC Direct'
        : (COMPETITOR_LABELS[row.competitor] ?? row.competitor)

    if (!grouped.has(slug)) {
      grouped.set(slug, { label, points: [] })
    }
    grouped.get(slug)!.points.push({
      date: new Date(row.run_date).getTime(),
      pricePerM2: Number(row.price_per_m2),
    })
  }

  return NextResponse.json({
    competitors: Array.from(grouped.entries()).map(([slug, { label, points }]) => ({
      slug,
      label,
      points,
    })),
  })
}
