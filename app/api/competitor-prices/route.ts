import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

const COMPETITORS = [
  'simply-plastics',
  'plastic-people',
  'cut-plastic-sheeting',
  'sheet-plastics',
  'plastic-sheet-shop',
  'plastic-sheets',
] as const

const COMPETITOR_LABELS: Record<string, string> = {
  'simply-plastics':      'Simply Plastics',
  'plastic-people':       'Plastic People',
  'cut-plastic-sheeting': 'Cut Plastic Sheeting',
  'sheet-plastics':       'Sheet Plastics',
  'plastic-sheet-shop':   'Plastic Sheet Shop',
  'plastic-sheets':       'Plastic Sheets',
}

export async function GET() {
  try {
    const basketItems = await prisma.competitorBasketItem.findMany({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
    })

    // For each competitor, get the latest AND second-latest price per basket item.
    // We use a window function so partial scrapes (e.g. --colour Black only) don't
    // wipe out Clear prices — each item independently tracks its own history.
    const competitorData = await Promise.all(
      COMPETITORS.map(async (slug) => {
        const rows = await prisma.$queryRaw<Array<{
          basket_item_id: string
          price_per_m2: string | null
          raw_value: string | null
          run_at: Date
          rn: bigint
        }>>`
          WITH ranked AS (
            SELECT
              cp.basket_item_id,
              cp.price_per_m2,
              cp.raw_value,
              cr.run_at,
              ROW_NUMBER() OVER (
                PARTITION BY cp.basket_item_id
                ORDER BY cr.run_at DESC
              ) AS rn
            FROM competitor_prices cp
            JOIN competitor_runs cr ON cp.run_id = cr.id
            WHERE cr.competitor = ${slug}
              AND cr.status IN ('success', 'partial')
          )
          SELECT * FROM ranked WHERE rn <= 2
          ORDER BY basket_item_id, rn
        `

        const currentByItem: Record<string, (typeof rows)[0]> = {}
        const previousByItem: Record<string, (typeof rows)[0]> = {}
        for (const row of rows) {
          if (Number(row.rn) === 1) currentByItem[row.basket_item_id] = row
          else if (Number(row.rn) === 2) previousByItem[row.basket_item_id] = row
        }
        // Use the most recent run_at across all items as the display timestamp
        const latestRunAt = rows.find((r) => Number(r.rn) === 1)?.run_at ?? null

        return { slug, label: COMPETITOR_LABELS[slug], currentByItem, previousByItem, latestRunAt }
      })
    )

    // For each basket item, get Cut My's retail price, variant name, and variantType
    const cutMyPrices: Record<string, number | null> = {}
    const cutMyNames: Record<string, string | null> = {}
    const cutMyVariantTypes: Record<string, string | null> = {}
    for (const item of basketItems) {
      if (item.magentoEntityId) {
        const material = await prisma.material.findFirst({
          where: { magentoEntityId: item.magentoEntityId },
        })
        if (material && material.markupMultiplier && material.costPerSheet) {
          const sheetAreaM2 = (Number(material.widthMm) * Number(material.heightMm)) / 1_000_000
          const retailPerSheet = Number(material.costPerSheet) * Number(material.markupMultiplier)
          cutMyPrices[item.id] = sheetAreaM2 > 0 ? retailPerSheet / sheetAreaM2 : null
        } else {
          cutMyPrices[item.id] = null
        }
        cutMyNames[item.id] = material?.magentoName ?? null
        cutMyVariantTypes[item.id] = material?.variantType ?? null
      } else {
        cutMyPrices[item.id] = null
        cutMyNames[item.id] = null
        cutMyVariantTypes[item.id] = null
      }
    }

    return NextResponse.json({
      basketItems: basketItems.map((i) => ({
        id: i.id,
        name: i.name,
        thicknessMm: Number(i.thicknessMm),
        widthMm: i.widthMm,
        heightMm: i.heightMm,
        magentoEntityId: i.magentoEntityId ?? null,
        cutMyVariantName: cutMyNames[i.id] ?? null,
        variantType: cutMyVariantTypes[i.id] ?? null,
      })),
      competitors: competitorData.map(({ slug, label, currentByItem, previousByItem, latestRunAt }) => ({
        slug,
        label,
        runAt: latestRunAt ?? null,
        prices: basketItems.map((item) => {
          const cur = currentByItem[item.id]
          const prev = previousByItem[item.id]
          return {
            basketItemId: item.id,
            pricePerM2: cur?.price_per_m2 != null ? Number(cur.price_per_m2) : null,
            previousPricePerM2: prev?.price_per_m2 != null ? Number(prev.price_per_m2) : null,
            rawValue: cur?.raw_value ?? null,
          }
        }),
      })),
      cutMyPrices,
      cutMyNames,
    })
  } catch (err) {
    console.error('competitor-prices API error:', err)
    return NextResponse.json({ error: 'Failed to load competitor prices' }, { status: 500 })
  }
}
