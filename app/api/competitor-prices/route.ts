import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const PLASTIC_COMPETITORS = [
  'simply-plastics',
  'plastic-people',
  'cut-plastic-sheeting',
  'sheet-plastics',
  'plastic-sheet-shop',
  'plastic-sheets',
] as const

// mdf-direct, ply-direct, and mfc-direct are all the same company (MDF/Ply/MFC Direct).
// Each sub-site only stocks its own product type so they never overlap — we merge them
// into a single column, coalescing to whichever slug has a non-null price per item.
const MDF_PLY_MFC_SLUGS = ['mdf-direct', 'ply-direct', 'mfc-direct'] as const

const WOOD_COMPETITORS = [
  'wood-sheets',
  'cnc-creations',
  'plastic-people-mdf',
  'cut-plastic-sheeting-mdf',
  'just-mdf',
] as const

const COMPETITOR_LABELS: Record<string, string> = {
  'simply-plastics':      'Simply Plastics',
  'plastic-people':       'Plastic People',
  'cut-plastic-sheeting': 'Cut Plastic Sheeting',
  'sheet-plastics':       'Sheet Plastics',
  'plastic-sheet-shop':   'Plastic Sheet Shop',
  'plastic-sheets':       'Plastic Sheets',
  'wood-sheets':          'Wood Sheets',
  'cnc-creations':        'CNC Creations',
  'plastic-people-mdf':         'Plastic People',
  'cut-plastic-sheeting-mdf':   'Cut Plastic Sheeting',
  'just-mdf':                   'Just MDF',
}

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') ?? 'plastic'
  const COMPETITORS = category === 'wood' ? WOOD_COMPETITORS : PLASTIC_COMPETITORS

  try {
    const basketItems = await prisma.competitorBasketItem.findMany({
      where: {
        active: true,
        category: category === 'wood' ? 'Wood' : 'Plastic',
      },
      orderBy: { createdAt: 'asc' },
    })

    // For each competitor, get the latest AND second-latest price per basket item.
    // We use a window function so partial scrapes (e.g. --colour Black only) don't
    // wipe out Clear prices — each item independently tracks its own history.
    const fetchSlug = async (slug: string) => {
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
            AND cp.price_per_m2 IS NOT NULL
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
      const latestRunAt = rows
        .filter((r) => Number(r.rn) === 1)
        .reduce<Date | null>((max, r) => (!max || r.run_at > max ? r.run_at : max), null)
      return { slug, currentByItem, previousByItem, latestRunAt }
    }

    const competitorData = await Promise.all(
      COMPETITORS.map(async (slug) => {
        const d = await fetchSlug(slug)
        return { slug, label: COMPETITOR_LABELS[slug], ...d }
      })
    )

    // Merge mdf-direct + ply-direct + mfc-direct into one column.
    // Since they never stock the same products, each item will have at most one non-null price.
    if (category === 'wood') {
      const [mdfData, plyData, mfcData] = await Promise.all(
        MDF_PLY_MFC_SLUGS.map(fetchSlug)
      )
      const mergedCurrentByItem: typeof mdfData.currentByItem = {}
      const mergedPreviousByItem: typeof mdfData.previousByItem = {}
      for (const itemId of Object.keys({
        ...mdfData.currentByItem,
        ...plyData.currentByItem,
        ...mfcData.currentByItem,
      })) {
        const cur =
          (mdfData.currentByItem[itemId]?.price_per_m2 != null ? mdfData.currentByItem[itemId] : null) ??
          (plyData.currentByItem[itemId]?.price_per_m2 != null ? plyData.currentByItem[itemId] : null) ??
          mfcData.currentByItem[itemId] ??
          undefined
        if (cur) mergedCurrentByItem[itemId] = cur
        const prev =
          (mdfData.previousByItem[itemId]?.price_per_m2 != null ? mdfData.previousByItem[itemId] : null) ??
          (plyData.previousByItem[itemId]?.price_per_m2 != null ? plyData.previousByItem[itemId] : null) ??
          mfcData.previousByItem[itemId] ??
          undefined
        if (prev) mergedPreviousByItem[itemId] = prev
      }
      const mergedRunAt = [mdfData.latestRunAt, plyData.latestRunAt, mfcData.latestRunAt]
        .filter((d): d is Date => d !== null)
        .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null)

      competitorData.push({
        slug: 'mdf-ply-mfc-direct',
        label: 'MDF/Ply/MFC Direct',
        currentByItem: mergedCurrentByItem,
        previousByItem: mergedPreviousByItem,
        latestRunAt: mergedRunAt,
      })
    }

    // Batch-fetch all mapped Cut My materials in one query, then look up in memory
    const mappedEntityIds = basketItems
      .map((i) => i.magentoEntityId)
      .filter((id): id is number => id !== null)

    const materials = mappedEntityIds.length
      ? await prisma.material.findMany({
          where: { magentoEntityId: { in: mappedEntityIds } },
          select: {
            magentoEntityId: true,
            magentoName: true,
            variantType: true,
            typeFinish: true,
            markupMultiplier: true,
            costPerSheet: true,
            widthMm: true,
            heightMm: true,
          },
        })
      : []

    const materialByEntityId = new Map(materials.map((m) => [m.magentoEntityId!, m]))

    const cutMyPrices: Record<string, number | null> = {}
    const cutMyNames: Record<string, string | null> = {}
    const cutMyVariantTypes: Record<string, string | null> = {}
    const cutMyTypeFinishes: Record<string, string | null> = {}
    for (const item of basketItems) {
      const material = item.magentoEntityId ? materialByEntityId.get(item.magentoEntityId) : undefined
      if (material && material.markupMultiplier && material.costPerSheet) {
        const sheetAreaM2 = (Number(material.widthMm) * Number(material.heightMm)) / 1_000_000
        const retailPerSheet = Number(material.costPerSheet) * Number(material.markupMultiplier)
        cutMyPrices[item.id] = sheetAreaM2 > 0 ? retailPerSheet / sheetAreaM2 : null
      } else {
        cutMyPrices[item.id] = null
      }
      cutMyNames[item.id] = material?.magentoName ?? null
      cutMyVariantTypes[item.id] = material?.variantType ?? null
      cutMyTypeFinishes[item.id] = material?.typeFinish ?? null
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
        typeFinish: cutMyTypeFinishes[i.id] ?? null,
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
