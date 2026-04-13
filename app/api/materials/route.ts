import { NextRequest, NextResponse } from 'next/server'
import { getMaterials, createMaterial } from '@/lib/db/materials'
import type { MaterialFilters } from '@/types'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl

    const filters: MaterialFilters = {}
    const category = searchParams.get('category')
    const typeFinish = searchParams.get('typeFinish')
    const variantType = searchParams.get('variantType')
    const supplierId = searchParams.get('supplierId')
    const search = searchParams.get('search')

    if (category) filters.category = category
    if (typeFinish) filters.typeFinish = typeFinish
    if (variantType) filters.variantType = variantType
    if (supplierId) filters.supplierId = supplierId
    if (search) filters.search = search

    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')
    const pagination = (limitParam !== null || offsetParam !== null)
      ? {
          limit: limitParam !== null ? parseInt(limitParam, 10) : undefined,
          offset: offsetParam !== null ? parseInt(offsetParam, 10) : undefined,
        }
      : undefined

    const { materials, total } = await getMaterials(filters, pagination)

    return NextResponse.json({ materials, total })
  } catch (error) {
    console.error('[GET /api/materials]', error)
    return NextResponse.json(
      { error: 'Failed to fetch materials', code: 'FETCH_ERROR' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const material = await createMaterial(body)
    return NextResponse.json({ material }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/materials]', error)
    const message = error instanceof Error ? error.message : 'Failed to create material'
    return NextResponse.json({ error: message, code: 'CREATE_ERROR' }, { status: 500 })
  }
}
